import { zeroAddress, type Address, type Hex } from "viem";
import type { ProtocolPort } from "./port";
import type { ResolvedConfig } from "../core/config";
import { ILeverAccAccountABI as accountAbi } from "../abi/ILeverAccAccount";
import { ILeverAccAccountFactoryABI as factoryAbi } from "../abi/ILeverAccAccountFactory";
import { ILeverAccFundVaultManagerABI as managerAbi } from "../abi/ILeverAccFundVaultManager";
import { IERC20ABI } from "../abi/IERC20";
import { invariant } from "../core/errors";
import { ILeverAccRegistryABI } from "../abi/ILeverAccRegistry";
import { ILeverAccL1ReadAdapterABI } from "../abi/ILeverAccL1ReadAdapter";
import {
  buildCreateAccountIntent,
  buildCreateAccountTypedData,
} from "./account-factory-intent";
import {
  buildBindProjectIntent,
  buildBindProjectTypedData,
} from "./bind-project-intent";
import type { Balances } from "../types";
export interface RuntimeStatus {
  accountState: number;
  pendingGasChargeDebtUsdc: bigint;
  availableAssetBalance: bigint;
  availableUserAssetBalance: bigint;
  totalRealtimeDebtNow: bigint;
  borrowPrincipalOutstanding?: bigint;
  payableInterestNow?: bigint;
  stopRequestedAt: bigint;
}
export interface Capacity {
  finalAdditionalBorrowAllowed: bigint;
  blockerCode: number;
  borrowPaused: boolean;
  coreUserActivated: boolean;
}
export interface AccountState {
  account: Address;
  projectId: Hex;
  bindingEpoch: bigint;
  nonce: bigint;
  runtime: RuntimeStatus;
  capacity: Capacity;
  execution: Address;
  risk: Address;
  executionMode: number;
  executionProject: Hex;
  registry: Address;
  balances: Balances;
  asset: Address;
  minimumBorrow: bigint;
  overview?: import("../types").Snapshot["overview"];
}
export const same = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
export const accountCall = (
  address: Address,
  functionName: string,
  args?: readonly unknown[],
) => ({ address, abi: accountAbi, functionName, args });
export async function primary(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
) {
  return port.read<Address>({
    address: config.factory,
    abi: factoryAbi,
    functionName: "primaryAccountOf",
    args: [owner],
  });
}
export async function readAccount(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  account: Address,
): Promise<AccountState> {
  const read = <T>(name: string) => port.read<T>(accountCall(account, name));
  const [
    user,
    factory,
    projectId,
    bindingEpoch,
    nonce,
    runtime,
    capacity,
    execution,
    risk,
    executionMode,
    executionProject,
    registry,
    asset,
  ] = await Promise.all([
    read<Address>("user"),
    read<Address>("factory"),
    read<Hex>("projectId"),
    read<bigint>("projectBindingEpoch"),
    read<bigint>("userIntentNonce"),
    read<RuntimeStatus>("getAccountRuntimeStatus"),
    port.read<Capacity>(
      accountCall(account, "previewBorrowCapacity", [config.projectId]),
    ),
    read<Address>("executionApiWallet"),
    read<Address>("riskApiWallet"),
    read<number>("executionWalletMode"),
    read<Hex>("executionWalletAuthorizedProjectId"),
    read<Address>("registry"),
    port.read<Address>({
      address: config.manager,
      abi: managerAbi,
      functionName: "asset",
    }),
  ]);
  invariant(
    same(user, owner) && same(factory, config.factory),
    "ACCOUNT_MISMATCH",
    "On-chain account owner or factory mismatch.",
  );
  const [adapter, limits] = await Promise.all([
    port.read<Address>({
      address: registry,
      abi: ILeverAccRegistryABI,
      functionName: "l1ReadAdapter",
    }),
    port.read<readonly bigint[]>({
      address: registry,
      abi: ILeverAccRegistryABI,
      functionName: "effectiveBorrowRiskConfig",
      args: [account],
    }),
  ]);
  invariant(
    !same(adapter, zeroAddress),
    "CORE_READ_UNAVAILABLE",
    "Core read adapter is not configured.",
  );
  const [evmCollateral, fund, spotState, perpsState] = await Promise.all([
    port
      .read<bigint>({
        address: asset,
        abi: IERC20ABI,
        functionName: "balanceOf",
        args: [account],
      })
      .catch(() => undefined),
    port.read<bigint>({
      address: asset,
      abi: IERC20ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    port.read<{ total: bigint; hold: bigint }>({
      address: adapter,
      abi: ILeverAccL1ReadAdapterABI,
      functionName: "readCoreSpotBalanceState",
      args: [account, 0n],
    }),
    port.read<{
      withdrawable: bigint;
      accountValue?: bigint;
      marginUsed?: bigint;
    }>({
      address: adapter,
      abi: ILeverAccL1ReadAdapterABI,
      functionName: "readCoreUserState",
      args: [0, account],
    }),
  ]);
  // Adapter exposes raw Core USDC8; protocol and Perps balances are USDC6.
  const spot =
    spotState.total > spotState.hold
      ? (spotState.total - spotState.hold) / 100n
      : 0n;
  // Summary failure never invents a zero balance or hides the verified account.
  const summary = await port
    .read<{ userNetEquityNow: bigint; accountNetValueNow: bigint }>(
      accountCall(account, "previewWithdrawablePrimaryDirect", [0]),
    )
    .catch(() => undefined);
  const coreValue =
    spotState.total !== 0n ? spotState.total / 100n : perpsState.accountValue;
  const coreEquity =
    coreValue === undefined
      ? undefined
      : coreValue > runtime.totalRealtimeDebtNow
        ? coreValue - runtime.totalRealtimeDebtNow
        : 0n;
  const overview = {
    collateral:
      coreEquity === undefined || evmCollateral === undefined
        ? undefined
        : evmCollateral + coreEquity,
    collateralBreakdown: { evm: evmCollateral, core: coreEquity },
    tradingAvailable: spot,
    riskBps:
      summary && summary.accountNetValueNow > 0n
        ? (runtime.totalRealtimeDebtNow * 10000n) / summary.accountNetValueNow
        : summary && runtime.totalRealtimeDebtNow === 0n
          ? 0n
          : undefined,
  };
  return {
    account,
    projectId,
    bindingEpoch,
    nonce,
    runtime,
    capacity,
    execution,
    risk,
    executionMode,
    executionProject,
    registry,
    asset,
    minimumBorrow: limits[0],
    overview,
    balances: {
      fund,
      evm: runtime.availableAssetBalance,
      spot: spot > 0n ? spot : 0n,
      perps: perpsState.withdrawable,
      debt: runtime.totalRealtimeDebtNow,
      borrowable: capacity.finalAdditionalBorrowAllowed,
    },
  };
}
/** Eligibility follows on-chain project authorization and the protocol preview.
 * Host registration, sessions and trading API policies do not gate contract calls. */
export function readiness(
  state: AccountState,
  config: ResolvedConfig,
): string[] {
  const reasons: string[] = [];
  if (!same(state.projectId, config.projectId) || state.bindingEpoch < 1n)
    reasons.push("PROJECT_BINDING_REQUIRED");
  if (
    same(state.execution, zeroAddress) ||
    state.executionMode !== 2 ||
    !same(state.executionProject, config.projectId)
  )
    reasons.push("EXECUTION_AUTHORIZATION_REQUIRED");
  if (same(state.risk, zeroAddress)) reasons.push("RISK_WALLET_REQUIRED");
  if (!state.capacity.coreUserActivated)
    reasons.push("CORE_ACTIVATION_REQUIRED");
  if (state.capacity.blockerCode !== 0)
    reasons.push(`BORROW_BLOCKED_${state.capacity.blockerCode}`);
  return reasons;
}
export const CREATION_GAS_MINIMUM = 10_000_000_000_000_000n;
export async function createAccount(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
) {
  const existing = await primary(port, config, owner);
  if (!same(existing, zeroAddress)) return existing;
  invariant(
    !config.creationGasConversionEnabled ||
      (await port.nativeBalance(owner)) >= CREATION_GAS_MINIMUM,
    "INSUFFICIENT_GAS",
    "Fund your owner wallet with at least 0.01 HYPE before creating the account.",
  );
  const nonce = await port.read<Hex>({
    address: config.factory,
    abi: factoryAbi,
    functionName: "createAccountNonce",
    args: [owner],
  });
  const intent = buildCreateAccountIntent(owner, {
    projectId: config.projectId,
    nonce,
  });
  const signature = await port.sign(
    buildCreateAccountTypedData(intent, config.chain.id, config.factory),
  );
  await port.write({
    address: config.factory,
    abi: factoryAbi,
    functionName: "createAccount",
    args: [intent, signature],
  });
}
export async function bindProject(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  state: AccountState,
) {
  const lots = await port.read<bigint>(
    accountCall(state.account, "activeBorrowLotCount"),
  );
  invariant(
    state.runtime.totalRealtimeDebtNow === 0n &&
      state.runtime.pendingGasChargeDebtUsdc === 0n &&
      lots === 0n &&
      state.runtime.stopRequestedAt === 0n,
    "PROJECT_SWITCH_BLOCKED",
    "Project switching is blocked by debt or a pending lifecycle action.",
  );
  const intent = buildBindProjectIntent({
    fromProjectId: state.projectId,
    toProjectId: config.projectId,
    account: state.account,
    user: owner,
    nonce: state.nonce + 1n,
    currentProjectBindingEpoch: state.bindingEpoch,
    nextProjectBindingEpoch: state.bindingEpoch + 1n,
  });
  const signature = await port.sign(
    buildBindProjectTypedData(intent, config.chain.id, state.account),
  );
  await port.write(
    accountCall(state.account, "bindProject", [intent, signature]),
  );
  const [project, epoch] = await Promise.all([
    port.read<Hex>(accountCall(state.account, "projectId")),
    port.read<bigint>(accountCall(state.account, "projectBindingEpoch")),
  ]);
  invariant(
    same(project, config.projectId) && epoch === intent.nextProjectBindingEpoch,
    "PROJECT_SWITCH_FAILED",
    "Project binding was not confirmed on chain.",
  );
}
