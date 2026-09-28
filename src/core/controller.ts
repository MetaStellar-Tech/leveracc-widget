import { zeroAddress, type Address, type Hex } from "viem";
import {
  prepareAccountTransfer,
  advanceAccountTransfer,
  readOwnerCore,
  executeAccountTransfer,
} from "../protocol/account-transfer";
import { ILeverAccFundVaultManagerABI } from "../abi/ILeverAccFundVaultManager";
import {
  readArbitrumTradeBalance,
  arbitrumWithdrawalTopup,
} from "../protocol/arbitrum-balance";
import { quoteWithdrawal } from "../protocol/withdraw";
import type {
  WidgetOptions,
  Snapshot,
  WidgetEvent,
  Action,
  Feature,
  Stage,
  OperationRecord,
  TransferRoute,
  EventContext,
} from "../types";
import { resolveConfig, type ResolvedConfig } from "./config";
import { walletAddress } from "./wallet";
import { invariant, normalizeError } from "./errors";
import { parseAmount } from "./amount";
import { createPort, type ProtocolPort } from "../protocol/port";
import {
  primary,
  accountCall,
  readAccount,
  readiness,
  createAccount,
  CREATION_GAS_MINIMUM,
  bindProject,
  same,
  type AccountState,
} from "../protocol/account";
import {
  borrow,
  repay,
  deposit,
  transfer,
  readBorrowRate,
} from "../protocol/funds";
import {
  clearLegacyTransactions,
  terminal,
  withOperationLock,
} from "./operations";
import { bridgeClients } from "../bridge/client";
import {
  submitDeposit,
  withdrawArbitrum,
  withdrawFundArbitrum,
} from "../bridge/submit";
import { cctpDeployment, type CctpOperation } from "../bridge/cctp";
import { listGasTopUps, isCreationTopUp } from "../protocol/gas-top-ups";
import { startGasFunding } from "../protocol/gas-funding";
import {
  gasFundingKey,
  withGasFundingLock,
} from "../protocol/gas-funding-store";
import { CircleFeeCache } from "../bridge/fee-cache";

import { CctpUsdcABI } from "../abi/generated/CctpUsdc";

const empty = (): Snapshot => ({
  status: "disconnected",
  reasons: [],
  busy: false,
  owner: undefined,
  account: undefined,
  boundProjectId: undefined,
  bindingEpoch: undefined,
  balances: undefined,
  balanceRevision: 0,
  minimumBorrow: undefined,
  overview: undefined,
  debtDetails: undefined,
  error: undefined,
  operation: undefined,
  continuation: undefined,
});
export class WidgetController {
  config: ResolvedConfig;
  private options: WidgetOptions;
  private generation = 0;
  private refreshVersion = 0;
  private disposed = false;
  private bridgeFees = new CircleFeeCache();
  private pendingReads = new Map<string, Promise<unknown>>();
  private sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
    const scopedKey = `${this.generation}:${this.refreshVersion}:${key}`;
    const pending = this.pendingReads.get(scopedKey);
    if (pending) return pending as Promise<T>;
    const request = read();
    this.pendingReads.set(scopedKey, request);
    const clear = () => {
      this.pendingReads.delete(scopedKey);
    };
    void request.then(clear, clear);
    return request;
  }
  private listeners = new Set<() => void>();
  private state: Snapshot = empty();
  private accountListener = () => {
    this.invalidate();
    void this.refresh();
  };
  private disconnectListener = () => {
    this.invalidate();
  };
  private chainListener = () => {
    if (!this.state.busy) {
      this.invalidate();
      void this.refresh();
    }
  };
  constructor(options: WidgetOptions) {
    this.options = options;
    this.config = resolveConfig(options.config);
    clearLegacyTransactions();
    this.attach();
  }
  get hasWallet() {
    return !!this.options.wallet || !!this.options.onConnect;
  }
  get hasAccountSetup() {
    return !!this.options.onAccountSetup;
  }
  get hasGasTopUp() {
    return true;
  }
  get usesBuiltInGasTopUp() {
    return !this.options.onGasTopUp;
  }
  private async hostAction(action: "setup" | "gas") {
    invariant(
      !this.state.busy && terminal(this.state.operation),
      "OPERATION_BUSY",
      "Wait for the current operation to finish.",
    );
    const context = this.context();
    invariant(
      context.owner,
      "WALLET_NOT_CONNECTED",
      "Connect the owner wallet first.",
    );
    const callback =
      action === "setup"
        ? this.options.onAccountSetup
        : this.options.onGasTopUp;
    invariant(
      callback,
      "HOST_ACTION_UNAVAILABLE",
      "This action must be configured by the host application.",
    );
    if (action === "setup")
      invariant(
        context.account,
        "ACCOUNT_REQUIRED",
        "Create a Trading Account first.",
      );
    const generation = this.generation;
    this.patch({ busy: true, error: undefined });
    try {
      if (action === "gas") {
        const readiness = await this.creationReadiness();
        invariant(
          generation === this.generation && !this.disposed,
          "CONTEXT_CHANGED",
          "Wallet context changed.",
        );
        if (readiness.ready) return;
      }
      if (action === "setup")
        await this.options.onAccountSetup!({
          ...context,
          owner: context.owner,
          account: context.account!,
          reasons: [...this.state.reasons],
        });
      else await this.options.onGasTopUp!({ ...context, owner: context.owner });
      if (generation === this.generation) await this.refresh();
    } catch (error) {
      if (generation === this.generation) this.report(error, context);
    } finally {
      if (generation === this.generation) this.patch({ busy: false });
    }
  }
  setupAccount = () => this.hostAction("setup");
  topUpGas = async () => {
    if (this.options.onGasTopUp) return this.hostAction("gas");
    invariant(
      !this.state.busy && terminal(this.state.operation),
      "OPERATION_BUSY",
      "Wait for the current operation to finish.",
    );
    const config = this.config,
      owner = this.state.owner,
      provider = this.options.wallet,
      generation = this.generation;
    invariant(
      owner && provider,
      "WALLET_NOT_CONNECTED",
      "Connect the owner wallet first.",
    );
    const current = () => generation === this.generation && !this.disposed;
    const key = gasFundingKey(config, owner);
    this.patch({ busy: true, error: undefined });
    try {
      await withGasFundingLock(key, async () => {
        const readiness = await this.creationReadiness();
        if (readiness.ready) return;
        const submitted = await startGasFunding(
          config,
          provider,
          owner,
          this.port(config, owner, undefined, generation),
          current,
          (submitting) =>
            this.port(config, owner, undefined, generation, (stage) => {
              if (stage === "submitting") submitting();
            }),
        );
        if (submitted) {
          const op: OperationRecord = {
            ...this.context(config),
            owner,
            id: crypto.randomUUID(),
            action: "gasFunding",
            stage: "submitted",
            createdAt: Date.now(),
            chainId: submitted.source === "arbitrum" ? 42161 : config.chain.id,
            hash: submitted.hash,
          };
          if (current()) this.patch({ operation: op });
          this.emit({ ...op, type: "operationSubmitted", operationId: op.id });
        }
      });
    } catch (error) {
      if (current()) this.report(error, { ...this.context(config), owner });
      throw error;
    } finally {
      if (current()) this.patch({ busy: false });
    }
  };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(patch: Partial<Snapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private emit(event: WidgetEvent) {
    if (this.disposed) return;
    try {
      this.options.onEvent?.(event);
    } catch {
      /* Host callbacks must not interrupt transaction submission. */
    }
  }
  private context(config = this.config): EventContext {
    return {
      projectId: config.projectId,
      network: config.network,
      owner: this.state.owner,
      account: this.state.account,
    };
  }
  private attach() {
    this.options.wallet?.on?.("accountsChanged", this.accountListener);
    this.options.wallet?.on?.("chainChanged", this.chainListener);
    this.options.wallet?.on?.("disconnect", this.disconnectListener);
  }
  private detach() {
    this.options.wallet?.removeListener?.(
      "accountsChanged",
      this.accountListener,
    );
    this.options.wallet?.removeListener?.("chainChanged", this.chainListener);
    this.options.wallet?.removeListener?.(
      "disconnect",
      this.disconnectListener,
    );
  }
  private invalidate() {
    this.generation++;
    this.refreshVersion++;
    this.patch({
      ...empty(),
      status: "disconnected",
    });
  }
  update(options: Partial<WidgetOptions>) {
    const next = { ...this.options, ...options };
    const resolved = resolveConfig(next.config);
    const contextChanged =
      next.wallet !== this.options.wallet ||
      resolved.projectId !== this.config.projectId ||
      resolved.network !== this.config.network ||
      resolved.rpcUrl !== this.config.rpcUrl ||
      resolved.arbitrumRpcUrl !== this.config.arbitrumRpcUrl ||
      resolved.protocolServiceUrl !== this.config.protocolServiceUrl;
    this.detach();
    this.options = next;
    this.config = resolved;
    this.attach();
    if (contextChanged) {
      this.invalidate();
      void this.refresh();
    } else this.patch({});
  }
  private port(
    config: ResolvedConfig,
    owner: Address,
    account: Address | undefined,
    generation: number,
    progress: (stage: Stage, hash?: Hex) => void = () => {},
    permitted: () => boolean = () => true,
  ) {
    const provider = this.options.wallet;
    invariant(
      provider,
      "WALLET_NOT_CONNECTED",
      "Connect a wallet in the host application.",
    );
    let port: ProtocolPort;
    port = createPort(
      config,
      provider,
      owner,
      () => !this.disposed && this.generation === generation && permitted(),
      progress,
      async () => {
        invariant(
          this.generation === generation && !this.disposed && permitted(),
          "CONTEXT_CHANGED",
          "Account or configuration changed.",
        );
        if (account)
          invariant(
            same(await primary(port, config, owner), account),
            "ACCOUNT_MISMATCH",
            "Factory primary account changed.",
          );
      },
    );
    return port;
  }
  async connect() {
    if (this.state.busy) return;
    const generation = this.generation;
    this.patch({ busy: true, error: undefined });
    try {
      if (this.options.onConnect) await this.options.onConnect();
      const provider = this.options.wallet;
      // Host login can complete asynchronously and update wallet props later.
      if (!provider && this.options.onConnect) return;
      invariant(
        provider,
        "WALLET_NOT_CONNECTED",
        "Connect a wallet in the host application.",
      );
      const owner = await walletAddress(provider, !this.options.onConnect);
      if (provider !== this.options.wallet || this.disposed) return;
      this.patch({ owner });
      await this.refresh();
    } catch (e) {
      if (generation === this.generation) this.report(e);
    } finally {
      if (generation === this.generation) this.patch({ busy: false });
    }
  }
  private report(
    error: unknown,
    context = this.context(),
    op?: OperationRecord,
  ) {
    const e = normalizeError(error);
    this.emit({
      ...context,
      type: "error",
      code: e.code,
      message: e.message,
      operationId: op?.id,
      hash: op?.hash,
    });
    if (
      (context.projectId === this.config.projectId &&
        context.network === this.config.network &&
        same(context.owner, this.state.owner)) ||
      !context.owner
    )
      this.patch({ error: e.message });
  }
  async refresh(): Promise<void> {
    const version = ++this.refreshVersion,
      generation = this.generation,
      config = this.config;
    const isCurrent = () =>
      version === this.refreshVersion &&
      generation === this.generation &&
      !this.disposed;
    if (!this.options.wallet) {
      this.patch({ status: "disconnected" });
      return;
    }
    // Keep resolved content visible during refreshes within the same context.
    const hasContent =
      this.state.status === "ready" ||
      this.state.status === "noAccount" ||
      this.state.status === "readError";
    this.patch({
      status: hasContent ? this.state.status : "loading",
      error: undefined,
    });
    try {
      const owner = await walletAddress(this.options.wallet);
      if (!isCurrent()) return;
      if (this.state.owner && !same(this.state.owner, owner)) {
        this.invalidate();
        return this.refresh();
      }
      this.patch({ owner });
      const port = this.port(config, owner, undefined, generation),
        account = await primary(port, config, owner);
      if (this.state.account && !same(this.state.account, account)) {
        this.invalidate();
        return this.refresh();
      }
      const context = {
        network: config.network,
        projectId: config.projectId,
        owner,
        account: same(account, zeroAddress) ? undefined : account,
      };
      if (same(account, zeroAddress)) {
        if (isCurrent()) {
          this.patch({
            status: "noAccount",
            account: undefined,
            balances: undefined,
            reasons: [],
            operation: this.state.operation,
          });
          this.emit({
            ...context,
            type: "accountChanged",
            status: "noAccount",
          });
        }
        return;
      }
      const s = await readAccount(port, config, owner, account),
        reasons = readiness(s, config);
      if (!isCurrent()) return;
      this.patch({
        status: "ready",
        account,
        boundProjectId: s.projectId,
        bindingEpoch: s.bindingEpoch,
        balances: s.balances,
        balanceRevision: (this.state.balanceRevision ?? 0) + 1,
        minimumBorrow: s.minimumBorrow,
        overview: s.overview,
        debtDetails: {
          principal: s.runtime.borrowPrincipalOutstanding,
          interest: s.runtime.payableInterestNow,
        },
        reasons,
        operation: this.state.operation,
      });
      this.emit({ ...context, type: "accountChanged", status: "ready" });
      if (reasons.length)
        this.emit({ ...context, type: "accountActionRequired", reasons });
    } catch (e) {
      if (isCurrent()) {
        if (normalizeError(e).code === "WALLET_NOT_CONNECTED") {
          this.patch({ ...empty() });
          this.emit({
            ...this.context(),
            type: "accountChanged",
            status: "disconnected",
          });
          return;
        }
        this.patch({ status: hasContent ? this.state.status : "readError" });
        this.report(e);
      }
    }
  }
  private progress(
    op: OperationRecord,
    stage: Stage,
    hash?: Hex,
    generation = this.generation,
  ) {
    const duplicate = stage === "submitted" && op.stage === "submitted";
    op.stage = stage;
    if (stage === "submitted") delete op.error;
    if (hash) {
      op.hash = hash;
      if (op.bridge) op.bridge.hash = hash;
    }
    if (generation === this.generation && this.matches(op))
      this.patch({
        operation: { ...op },
        continuation:
          stage === "awaitingAction"
            ? { ...op }
            : this.state.continuation?.id === op.id && stage === "submitted"
              ? undefined
              : this.state.continuation,
      });
    if (duplicate) return;
    this.emit({
      ...op,
      type: stage === "submitted" ? "operationSubmitted" : "operationProgress",
      operationId: op.id,
    });
  }
  private matches(op: EventContext) {
    return (
      op.projectId === this.config.projectId &&
      op.network === this.config.network &&
      same(op.owner, this.state.owner)
    );
  }
  private async run(
    action: Action,
    work: (
      port: ProtocolPort,
      config: ResolvedConfig,
      owner: Address,
      s: AccountState | undefined,
      op: OperationRecord,
      progress: (stage: Stage, hash?: Hex) => void,
    ) => Promise<void>,
    resume = false,
  ) {
    const feature = action === "bridgeApproval" ? "deposit" : action;
    if (feature in this.config.features)
      invariant(
        this.config.features[feature as Feature],
        "FEATURE_DISABLED",
        "This feature is disabled.",
      );
    invariant(
      !this.state.busy,
      "OPERATION_BUSY",
      "An operation is already running.",
    );
    invariant(
      this.state.owner && this.options.wallet,
      "WALLET_NOT_CONNECTED",
      "Connect a wallet before continuing.",
    );
    invariant(
      this.state.status === "ready" || this.state.status === "noAccount",
      "ACCOUNT_UNAVAILABLE",
      "Refresh account state before continuing.",
    );
    const config = this.config,
      owner = this.state.owner,
      account = this.state.account,
      generation = this.generation,
      context = this.context(config);
    this.patch({ busy: true, error: undefined });
    try {
      await withOperationLock(context, async () => {
        const previous = this.state.continuation;
        invariant(
          !resume ||
            (previous?.stage === "awaitingAction" &&
              (previous.transferFlow || previous.arbitrumWithdrawal) &&
              previous.action === action &&
              same(previous.account, account)),
          "OPERATION_PENDING",
          "No account transfer is ready to continue.",
        );
        const op: OperationRecord = resume
          ? structuredClone(previous!)
          : {
              ...context,
              id: crypto.randomUUID(),
              action,
              stage: "preparing",
              chainId: config.chain.id,
              createdAt: Date.now(),
            };
        delete op.hash;
        delete op.error;
        let port: ProtocolPort;
        let didSubmit = false;
        const progress = (stage: Stage, hash?: Hex) => {
          if (stage === "submitted") didSubmit = true;
          this.progress(op, stage, hash, generation);
        };
        const basePort = this.port(
          config,
          owner,
          account,
          generation,
          progress,
          () =>
            !(feature in this.config.features) ||
            this.config.features[feature as Feature],
        );
        const enabled = () => {
          invariant(
            !(feature in this.config.features) ||
              this.config.features[feature as Feature],
            "FEATURE_DISABLED",
            "This feature is disabled.",
          );
        };
        port = {
          ...basePort,
          sign: async (data) => {
            enabled();
            return basePort.sign(data);
          },
          write: async (call) => {
            enabled();
            const hash = await basePort.write(call);
            progress("submitted", hash);
            return hash;
          },
          sendCore: async (destination, amount) => {
            enabled();
            await basePort.sendCore(destination, amount);
            progress("submitted");
          },
        };
        progress("preparing");
        try {
          invariant(
            same(await walletAddress(this.options.wallet!), owner),
            "OWNER_WALLET_MISMATCH",
            "Connected owner wallet changed.",
          );
          const s = account
            ? await readAccount(port, config, owner, account)
            : undefined;
          await work(port, config, owner, s, op, progress);
          if (!didSubmit) {
            if (op.transferFlow || op.arbitrumWithdrawal)
              progress("awaitingAction");
            else if (generation === this.generation && this.matches(op))
              this.patch({ operation: undefined });
            return;
          }
          if (op.transferFlow) {
            const next = advanceAccountTransfer(op);
            if (next === "awaitingAction") progress(next);
          } else if (op.arbitrumWithdrawal?.step === "topup") {
            op.arbitrumWithdrawal.topupHash = op.hash;
            op.arbitrumWithdrawal.step = "bridge";
            progress("awaitingAction");
          }
        } catch (error) {
          const e = normalizeError(error);
          op.error = e.message;
          if (
            op.stage === "submitting" &&
            !op.hash &&
            e.code !== "USER_REJECTED"
          )
            op.error +=
              " Submission result is unknown. Check your wallet before retrying.";
          progress(
            didSubmit
              ? "submitted"
              : op.transferFlow || op.arbitrumWithdrawal
                ? "awaitingAction"
                : "failed",
          );
          e.message = op.error ?? e.message;
          this.report(e, context, op);
        }
      });
    } catch (e) {
      this.report(e, context);
    } finally {
      if (generation === this.generation) {
        this.patch({ busy: false });
        void this.refresh();
      }
    }
  }
  async creationGas() {
    invariant(
      this.state.owner,
      "WALLET_NOT_CONNECTED",
      "Connect a wallet first.",
    );
    return this.port(
      this.config,
      this.state.owner,
      undefined,
      this.generation,
    ).nativeBalance(this.state.owner);
  }
  creationReadiness() {
    return this.sharedRead("creation", () => this.readCreationReadiness());
  }
  private async readCreationReadiness() {
    const owner = this.state.owner,
      config = this.config,
      generation = this.generation;
    invariant(owner, "WALLET_NOT_CONNECTED", "Connect a wallet first.");
    const [gas, records] = await Promise.all([
      this.port(config, owner, undefined, generation).nativeBalance(owner),
      listGasTopUps(config.protocolServiceUrl, owner),
    ]);
    invariant(
      generation === this.generation &&
        !this.disposed &&
        same(owner, this.state.owner),
      "CONTEXT_CHANGED",
      "Wallet context changed.",
    );
    const funding = {
      state: "idle" as const,
      error: undefined as string | undefined,
    };
    const hasTopUp = records.some(isCreationTopUp);
    return {
      gas,
      hasTopUp,
      funding,
      ready: hasTopUp && gas >= CREATION_GAS_MINIMUM,
    };
  }
  createAccount = () =>
    this.run("createAccount", async (port, config, owner) => {
      const readiness = await this.creationReadiness();
      invariant(
        readiness.hasTopUp,
        "CREATION_TOP_UP_REQUIRED",
        "A successful 3 USDC gas top-up is required before creating the account.",
      );
      invariant(
        readiness.ready,
        "INSUFFICIENT_GAS",
        "Fund your owner wallet with at least 0.01 HYPE before creating the account.",
      );
      await createAccount(port, config, owner);
    });
  bindProject = () =>
    this.run("bindProject", async (port, config, owner, s) => {
      invariant(s, "ACCOUNT_REQUIRED", "Create a Trading Account first.");
      await bindProject(port, config, owner, s);
    });
  borrow = (amount: string, reviewedVersion?: bigint) =>
    this.run("borrow", async (port, config, owner, s) => {
      invariant(s, "ACCOUNT_REQUIRED", "Create a Trading Account first.");
      const reasons = readiness(s, config);
      if (reasons.length)
        this.emit({
          projectId: config.projectId,
          network: config.network,
          owner,
          account: s.account,
          type: "accountActionRequired",
          reasons,
        });
      await borrow(
        port,
        config,
        owner,
        s,
        parseAmount(amount),
        reasons,
        reviewedVersion,
      );
    });
  repay = (amount: string, full = false) =>
    this.run("repay", async (port, config, owner, s) => {
      invariant(s, "ACCOUNT_REQUIRED", "Create a Trading Account first.");
      await repay(
        port,
        config,
        owner,
        s,
        full ? s.balances.debt : parseAmount(amount),
        full,
      );
    });
  deposit = (amount: string) =>
    this.run("deposit", async (port, _config, owner, s) => {
      invariant(s, "ACCOUNT_REQUIRED", "Create a Trading Account first.");
      await deposit(port, owner, s, parseAmount(amount));
    });
  transfer = (route: TransferRoute, amount: string, fee?: bigint) =>
    this.run(
      route === "tradeToFund" ||
        route === "tradeToArbitrum" ||
        route === "fundToArbitrum"
        ? "withdraw"
        : "transfer",
      async (port, config, owner, s, op) => {
        invariant(s, "ACCOUNT_REQUIRED", "Create a Trading Account first.");
        invariant(
          route !== "fundToTrade" && route !== "accountToFund",
          "UNSUPPORTED_ROUTE",
          "Use the account transfer flow.",
        );
        const units = parseAmount(amount);
        if (route === "tradeToArbitrum" || route === "fundToArbitrum") {
          invariant(
            fee !== undefined,
            "QUOTE_REQUIRED",
            "Review the bridge quote first.",
          );
          let prepared: Omit<CctpOperation, "hash"> | undefined;
          const bridgePort = {
            ...port,
            write: async (call: Parameters<ProtocolPort["write"]>[0]) => {
              // Keep the source transaction details only in this page.
              if (prepared) {
                op.bridge = {
                  ...prepared,
                  hash: ("0x" + "0".repeat(64)) as Hex,
                };
              }
              return port.write(call);
            },
          };
          if (route === "fundToArbitrum") {
            await withdrawFundArbitrum(
              bridgePort,
              config,
              owner,
              units,
              fee,
              (bridge) => {
                prepared = bridge;
              },
              () => {
                op.action = "bridgeApproval";
              },
              () =>
                this.bridgeFees.quote(units, "arbitrum", config.network, true),
            );
          } else
            await withdrawArbitrum(
              bridgePort,
              config,
              owner,
              s,
              units,
              fee,
              (bridge) => {
                prepared = bridge;
              },
              () =>
                this.bridgeFees.quote(units, "arbitrum", config.network, true),
            );
          if (prepared && op.hash) op.bridge = { ...prepared, hash: op.hash };
          return;
        }
        if (route !== "tradeToFund") {
          const activationFee =
            route === "evmToCore" && !s.capacity.coreUserActivated
              ? 1_000_000n
              : 0n;
          invariant(
            units > activationFee,
            "ACTIVATION_FEE",
            "Amount must exceed the Core activation fee.",
          );
        }
        await transfer(port, config, owner, s, route, units);
      },
    );
  withdrawToArbitrum = (amount: string, fee: bigint) =>
    this.run("withdraw", async (port, config, owner, state, op) => {
      invariant(
        state && config.arbitrumWithdrawalEnabled,
        "UNSUPPORTED_ROUTE",
        "Direct Arbitrum withdrawal is unavailable for this deployment.",
      );
      const units = parseAmount(amount);
      invariant(
        fee >= 0n && units > fee,
        "INVALID_AMOUNT",
        "Amount must exceed bridge fees.",
      );
      const estimate = await this.bridgeFees.quote(
        units,
        "arbitrum",
        config.network,
        true,
      );
      invariant(
        estimate <= fee,
        "FEE_CHANGED",
        "Bridge fee increased. Get a new quote and confirm again.",
      );
      op.arbitrumWithdrawal = {
        amount: units.toString(),
        fee: fee.toString(),
        step: "topup",
      };
      await this.executeArbitrum(port, config, owner, state, op, estimate);
    });
  continueArbitrumWithdrawal = (fee?: bigint) =>
    this.run(
      "withdraw",
      async (port, config, owner, state, op) => {
        invariant(
          state && op.arbitrumWithdrawal,
          "OPERATION_PENDING",
          "No Arbitrum withdrawal is ready to continue.",
        );
        if (fee !== undefined) {
          invariant(
            fee >= 0n && fee < BigInt(op.arbitrumWithdrawal.amount),
            "INVALID_AMOUNT",
            "Bridge fee must be below the withdrawal amount.",
          );
          op.arbitrumWithdrawal.fee = fee.toString();
        }
        delete op.hash;
        delete op.error;
        await this.executeArbitrum(port, config, owner, state, op);
      },
      true,
    );
  private async executeArbitrum(
    port: ProtocolPort,
    config: ResolvedConfig,
    owner: Address,
    state: AccountState,
    op: OperationRecord,
    checkedFee?: bigint,
  ) {
    const flow = op.arbitrumWithdrawal!;
    const units = BigInt(flow.amount);
    const balance = await readArbitrumTradeBalance(
      port,
      state.account,
      state.asset,
      config.network,
    );
    const topup = arbitrumWithdrawalTopup(balance, units);
    const estimate =
      checkedFee ??
      (await this.bridgeFees.quote(units, "arbitrum", config.network, true));
    invariant(
      estimate <= BigInt(flow.fee) && units > BigInt(flow.fee),
      "FEE_CHANGED",
      "Bridge fee increased. Get a new quote and confirm again.",
    );
    state = {
      ...state,
      balances: { ...state.balances, evm: balance.evm, spot: balance.core },
    };
    if (topup) {
      flow.step = "topup";
      await transfer(port, config, owner, state, "coreToEvm", topup);
      return;
    }
    flow.step = "bridge";
    await withdrawArbitrum(
      {
        ...port,
        write: async (call) => {
          // Submit the bridge step without waiting for destination credit.
          return port.write(call);
        },
      },
      config,
      owner,
      state,
      units,
      BigInt(flow.fee),
      (prepared) => {
        op.bridge = { ...prepared, hash: ("0x" + "0".repeat(64)) as Hex };
      },
      async () => estimate,
    );
  }
  accountTransfer = (
    direction: "fundToTrade" | "accountToFund",
    amount: string,
  ) =>
    this.run("transfer", async (port, config, owner, s, op) => {
      invariant(s, "ACCOUNT_REQUIRED", "Create a Trading Account first.");
      op.transferFlow = await prepareAccountTransfer(
        port,
        config,
        owner,
        s,
        direction,
        parseAmount(amount),
      );
      await executeAccountTransfer(port, config, owner, s, op.transferFlow);
    });
  continueTransfer = (reviewedMinimum?: bigint) =>
    this.run(
      this.state.continuation?.action === "withdraw" ? "withdraw" : "transfer",
      async (port, config, owner, s, op) => {
        invariant(
          s && op.transferFlow,
          "ACCOUNT_REQUIRED",
          "Refresh account state first.",
        );
        if (reviewedMinimum !== undefined) {
          invariant(
            op.action === "withdraw" && op.transferFlow.step === "withdraw",
            "INVALID_OPERATION",
            "Only a pending withdrawal can update its reviewed proceeds.",
          );
          const { plan } = await quoteWithdrawal(
            port,
            s,
            BigInt(op.transferFlow.amount),
          );
          invariant(
            reviewedMinimum > 0n &&
              reviewedMinimum <= BigInt(op.transferFlow.amount) &&
              plan!.netPayoutAmount >= reviewedMinimum,
            "WITHDRAW_QUOTE_CHANGED",
            "Withdrawal proceeds changed. Review again.",
          );
          op.transferFlow.withdrawMinimum = reviewedMinimum.toString();
        }
        await executeAccountTransfer(port, config, owner, s, op.transferFlow);
      },
      true,
    );
  quoteArbitrumWithdrawal() {
    return this.sharedRead("arbitrum-withdraw:maximum", async () => {
      const { owner, account } = this.state;
      invariant(
        owner && account,
        "ACCOUNT_REQUIRED",
        "Create an account first.",
      );
      const config = this.config,
        generation = this.generation;
      const port = this.port(config, owner, account, generation);
      const asset = await port.read<Address>({
        address: config.manager,
        abi: ILeverAccFundVaultManagerABI,
        functionName: "asset",
      });
      const result = await readArbitrumTradeBalance(
        port,
        account,
        asset,
        config.network,
      );
      invariant(
        generation === this.generation,
        "CONTEXT_CHANGED",
        "Account or network changed.",
      );
      return result;
    });
  }
  quoteWithdrawal(amount?: string) {
    return this.sharedRead(`withdraw:${amount ?? "maximum"}`, () =>
      this.readQuoteWithdrawal(amount),
    );
  }
  private async readQuoteWithdrawal(amount?: string) {
    invariant(
      this.state.owner && this.state.account,
      "ACCOUNT_REQUIRED",
      "Create an account first.",
    );
    const config = this.config,
      owner = this.state.owner,
      account = this.state.account,
      generation = this.generation;
    const port = this.port(config, owner, account, generation);
    const result = await quoteWithdrawal(
      port,
      await readAccount(port, config, owner, account),
      amount ? parseAmount(amount) : undefined,
    );
    invariant(
      generation === this.generation,
      "CONTEXT_CHANGED",
      "Account changed. Review again.",
    );
    return result;
  }
  withdraw = (amount: string, minimum: bigint) =>
    this.run("withdraw", async (port, config, owner, s, op) => {
      invariant(s, "ACCOUNT_REQUIRED", "Create an account first.");
      const units = parseAmount(amount);
      const { plan } = await quoteWithdrawal(port, s, units);
      invariant(
        minimum > 0n && plan!.netPayoutAmount >= minimum,
        "WITHDRAW_QUOTE_CHANGED",
        "Withdrawal proceeds changed. Review again.",
      );
      op.transferFlow = await prepareAccountTransfer(
        port,
        config,
        owner,
        s,
        "accountToFund",
        units,
      );
      op.transferFlow.withdrawMinimum = minimum.toString();
      await executeAccountTransfer(port, config, owner, s, op.transferFlow);
    });
  fundSourceBalances(source: "core" | "fund" | "both" = "both") {
    return this.sharedRead(`fund-source:${source}`, () =>
      this.readFundSourceBalances(source),
    );
  }
  private async readFundSourceBalances(
    source: "core" | "fund" | "both" = "both",
  ) {
    invariant(
      this.state.owner && this.state.account,
      "ACCOUNT_REQUIRED",
      "Create an account first.",
    );
    const { owner, account } = this.state;
    const generation = this.generation;
    const port = this.port(this.config, owner, account, generation);
    const core =
      source === "fund"
        ? undefined
        : await readOwnerCore(
            port,
            await port.read<Address>(accountCall(account, "registry")),
            owner,
          );
    const [fund, allowance] =
      source !== "core"
        ? await Promise.all([
            port.read<bigint>({
              address: cctpDeployment(this.config.network).evmUsdc,
              abi: CctpUsdcABI,
              functionName: "balanceOf",
              args: [owner],
            }),
            port.read<bigint>({
              address: cctpDeployment(this.config.network).evmUsdc,
              abi: CctpUsdcABI,
              functionName: "allowance",
              args: [owner, cctpDeployment(this.config.network).messenger],
            }),
          ])
        : [undefined, 0n];
    invariant(
      generation === this.generation,
      "CONTEXT_CHANGED",
      "Account changed. Refresh balances.",
    );
    return {
      core: core && core.available > 5000n ? core.available - 5000n : 0n,
      fund,
      allowance,
    };
  }
  depositFromCore = (amount: string) =>
    this.run("deposit", async (port, _config, owner, state, op) => {
      invariant(state, "ACCOUNT_REQUIRED", "Create an account first.");
      const units = parseAmount(amount);
      const core = await readOwnerCore(port, state.registry, owner);
      invariant(
        units + 5000n <= core.available,
        "INSUFFICIENT_BALANCE",
        "Insufficient owner Core Spot USDC after reserving Core dust.",
      );

      await port.sendCore("0x2000000000000000000000000000000000000000", amount);
    });
  quoteBorrow() {
    return this.sharedRead("borrow", () => this.readQuoteBorrow());
  }
  private async readQuoteBorrow() {
    invariant(
      this.state.owner && this.state.account,
      "ACCOUNT_REQUIRED",
      "Create an account first.",
    );
    const config = this.config,
      owner = this.state.owner,
      account = this.state.account,
      generation = this.generation;
    const port = this.port(config, owner, account, generation);
    const rate = await readBorrowRate(port, {
      registry: await port.read<Address>(accountCall(account, "registry")),
    });
    invariant(
      generation === this.generation,
      "CONTEXT_CHANGED",
      "Account changed. Review again.",
    );
    return rate;
  }
  async quoteBridge(amount: string, route: "fund" | "arbitrum" = "fund") {
    return this.bridgeFees.quote(
      amount === "0" ? 0n : parseAmount(amount),
      route,
      this.config.network,
    );
  }
  bridgeBalances(destinationOnly = false) {
    return this.sharedRead(`bridge-balances:${destinationOnly}`, () =>
      this.readBridgeBalances(destinationOnly),
    );
  }
  private async readBridgeBalances(destinationOnly: boolean) {
    invariant(
      this.state.owner,
      "WALLET_NOT_CONNECTED",
      "Connect a wallet first.",
    );
    const clients = bridgeClients(this.config);
    if (destinationOnly) {
      const balance = await clients.arb.readContract({
        address: cctpDeployment(this.config.network).usdc,
        abi: CctpUsdcABI,
        functionName: "balanceOf",
        args: [this.state.owner],
      });
      return { balance, allowance: undefined, gas: undefined };
    }
    return clients.balances(this.state.owner);
  }
  bridgeDeposit = (amount: string, fee: bigint, approveOnly = false) =>
    this.run(
      approveOnly ? "bridgeApproval" : "deposit",
      async (_port, config, owner, _s, op, progress) => {
        op.chainId = config.arbitrumChain.id;
        const generation = this.generation;
        const provider = this.options.wallet!;
        const result = await submitDeposit(
          config,
          provider,
          owner,
          parseAmount(amount),
          fee,
          approveOnly,
          () => this.generation === generation && !this.disposed,
          (stage, hash, bridge) => {
            if (bridge) op.bridge = bridge;
            progress(stage, hash);
          },
          () =>
            this.bridgeFees.quote(
              parseAmount(amount),
              "fund",
              config.network,
              true,
            ),
        );
        if (result) op.bridge = result;
      },
    );
  destroy() {
    this.disposed = true;
    this.generation++;
    this.detach();
    this.listeners.clear();
  }
}
