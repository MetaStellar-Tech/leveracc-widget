import { type Address, type WalletClient } from "viem";
import { arbitrum } from "viem/chains";
import type { ResolvedConfig } from "../core/config";
import type { WalletProvider } from "../types";
import { signer } from "../core/wallet";
import { normalizeError } from "../core/errors";
import { creationAmount, creationFlow } from "./creation-policy";
import { creationKey, loadCreation } from "./creation-tracking";
import { gasFundingRoute, ARBITRUM_USDC } from "./gas-funding";
import { readGaslessFunding } from "./gasless-chain";
import { getGaslessConfig, GaslessServiceError } from "./gasless-service";
import {
  prepareGasless,
  submitGasless,
  getGaslessStatus,
  type GaslessPayload,
} from "./gasless-api";
import {
  gaslessAmount,
  gaslessLimits,
  GaslessError,
  prepareMessage,
  signedGasless,
  validateGaslessQuote,
  assertQuoteFresh,
  type GaslessOperation,
} from "./gasless-validation";
import {
  loadGasless,
  saveGasless,
  probeGaslessStorage,
  withGaslessLock,
  reconcileGasless,
} from "./gasless-store";

export interface GaslessReadiness {
  ready: boolean;
  pending: boolean;
  disabled: boolean;
  error?: string;
  pollAfter: number;
  autoPoll?: false;
}
export function gaslessError(error: unknown) {
  if (error instanceof GaslessError) return error.message;
  if (normalizeError(error).code === "USER_REJECTED")
    return "signatureRejected";
  return error instanceof GaslessServiceError
    ? "serviceError"
    : "requestFailed";
}
export async function gaslessReadiness(
  config: ResolvedConfig,
  owner: Address,
): Promise<GaslessReadiness> {
  let pending = false;
  let checkingStatus = false;
  let pollAfter = 10000;
  try {
    let op = loadGasless(config, owner);
    pending = op?.stage === "submitted";
    if (pending && op) {
      checkingStatus = true;
      const status = await getGaslessStatus(config, op);
      if (
        status.trade_hash?.toLowerCase() !== op.trade_hash.toLowerCase() ||
        status.provider !== "0x" ||
        !["processing", "success", "failed"].includes(status.phase) ||
        typeof status.terminal !== "boolean"
      )
        throw new GaslessError("unknown");
      checkingStatus = false;
      pollAfter = Math.max(
        3000,
        Number.isFinite(status.next_poll_after_seconds)
          ? status.next_poll_after_seconds * 1000
          : 3000,
      );
      if (status.terminal && status.phase === "failed") {
        if (!(await reconcileGasless(config, owner, op, "failed")))
          return { ready: false, pending: true, disabled: true, pollAfter };
        op = { ...op, stage: "failed" };
        pending = false;
      } else if (!(status.terminal && status.phase === "success")) {
        return { ready: false, pending: true, disabled: true, pollAfter };
      }
    }
    const route = await gasFundingRoute(config, owner);
    if (route.source !== "arbitrum") throw new GaslessError("unavailable");
    const reserve = BigInt(creationAmount(creationFlow(config)));
    const balance = await readGaslessFunding(
      config,
      owner,
      route.receiver,
      reserve,
    );
    if (pending && op) {
      if (balance.eth <= BigInt(op.ethBefore))
        return { ready: false, pending: true, disabled: true, pollAfter };
      if (!(await reconcileGasless(config, owner, op, "success")))
        return { ready: false, pending: true, disabled: true, pollAfter };
      op = { ...op, stage: "success" };
      pending = false;
    }
    if (balance.sufficient)
      return { ready: true, pending: false, disabled: false, pollAfter };
    const limits = gaslessLimits(await getGaslessConfig(config));
    gaslessAmount(
      config.creationGaslessEthAmountUsdc,
      limits,
      balance.usdc,
      reserve,
    );
    return {
      ready: false,
      pending: false,
      disabled: false,
      pollAfter,
      error:
        op?.stage === "failed"
          ? "failed"
          : op?.stage === "success"
            ? "stillLow"
            : undefined,
    };
  } catch (error) {
    if (error instanceof GaslessServiceError)
      pollAfter = Math.max(pollAfter, error.retryAfterMs);
    return {
      ready: false,
      pending,
      disabled: true,
      error:
        checkingStatus &&
        error instanceof GaslessServiceError &&
        [401, 403, 404].includes(error.status)
          ? "statusUnavailable"
          : gaslessError(error),
      pollAfter,
      ...(checkingStatus &&
      (error instanceof GaslessError ||
        (error instanceof GaslessServiceError &&
          [401, 403, 404].includes(error.status)))
        ? { autoPoll: false as const }
        : {}),
    };
  }
}

export async function executeGasless(
  config: ResolvedConfig,
  owner: Address,
  provider: WalletProvider,
  current: () => boolean,
  onQuote?: (minimum: string) => void,
) {
  return withGaslessLock(config, owner, async () => {
    if (loadGasless(config, owner)?.stage === "submitted") return;
    if (loadCreation(creationKey(config, owner)))
      throw new GaslessError("inProgress");
    probeGaslessStorage(config, owner);
    const route = await gasFundingRoute(config, owner);
    if (route.source !== "arbitrum") throw new GaslessError("unavailable");
    const reserve = BigInt(creationAmount(creationFlow(config)));
    const funding = await readGaslessFunding(
      config,
      owner,
      route.receiver,
      reserve,
    );
    if (funding.sufficient) return;
    const limits = gaslessLimits(await getGaslessConfig(config));
    const amount = gaslessAmount(
      config.creationGaslessEthAmountUsdc,
      limits,
      funding.usdc,
      reserve,
    );
    const wallet = await signer(provider, owner, arbitrum, current);
    const checkWallet = async (w: WalletClient) => {
      if (
        !current() ||
        w.account?.address.toLowerCase() !== owner.toLowerCase() ||
        (await w.getAddresses())[0]?.toLowerCase() !== owner.toLowerCase() ||
        (await w.getChainId()) !== 42161 ||
        !current()
      )
        throw new GaslessError("ownerMismatch");
    };
    await checkWallet(wallet);
    const timestamp = Math.floor(Date.now() / 1000);
    const wallet_signature = await wallet.signMessage({
      account: wallet.account,
      message: prepareMessage(owner, amount, timestamp),
    });
    await checkWallet(wallet);
    const quote = await prepareGasless(config, {
      user_eoa: owner,
      source_chain_id: 42161,
      sell_token: ARBITRUM_USDC,
      sell_amount_raw: amount.toString(),
      timestamp,
      wallet_signature,
    });
    validateGaslessQuote(quote, owner, amount, funding.required - funding.eth);
    if (current()) onQuote?.(quote.min_buy_amount_raw);
    await checkWallet(wallet);
    let op: GaslessOperation = {
      version: 1,
      owner,
      network: config.chain.id,
      stage: "prepared",
      createdAt: Date.now(),
      ethBefore: funding.eth.toString(),
      amount: amount.toString(),
      trade_hash: quote.trade_hash,
      quote_token: quote.quote_token,
    };
    saveGasless(config, owner, op);
    let submitted = false;
    try {
      const sign = async (payload: GaslessPayload) => {
        await checkWallet(wallet);
        assertQuoteFresh(quote);
        return signedGasless(
          payload,
          await wallet.signTypedData({
            ...payload.eip712,
            account: wallet.account,
          }),
        );
      };
      const approval = quote.zeroex_quote.approval
        ? await sign(quote.zeroex_quote.approval)
        : undefined;
      const trade = await sign(quote.zeroex_quote.trade);
      await checkWallet(wallet);
      const latest = await readGaslessFunding(
        config,
        owner,
        route.receiver,
        reserve,
      );
      // External funding can arrive while the user is signing. Do not spend
      // USDC once the creation payment already has enough ETH.
      if (latest.sufficient) {
        saveGasless(config, owner, null);
        return;
      }
      gaslessAmount(
        config.creationGaslessEthAmountUsdc,
        limits,
        latest.usdc,
        reserve,
      );
      validateGaslessQuote(
        quote,
        owner,
        amount,
        latest.required > latest.eth ? latest.required - latest.eth : 0n,
      );
      await checkWallet(wallet);
      assertQuoteFresh(quote);
      op = { ...op, stage: "submitted" };
      saveGasless(config, owner, op);
      submitted = true;
      const result = await submitGasless(config, {
        source_chain_id: 42161,
        quote_token: quote.quote_token,
        trade,
        approval,
      });
      if (!/^0x[\da-f]{64}$/i.test(result.trade_hash) || !result.quote_token)
        throw new GaslessError("unknown");
      saveGasless(
        config,
        owner,
        {
          ...op,
          trade_hash: result.trade_hash,
          quote_token: result.quote_token,
        },
        true,
      );
    } catch (error) {
      // Only a local preflight rejection proves that submit never left the
      // browser. HTTP failures and timeouts retain write-ahead recovery.
      if (
        !submitted ||
        (error instanceof GaslessServiceError && !error.requestSent)
      )
        saveGasless(config, owner, null);
      if (
        submitted &&
        !(
          error instanceof GaslessError &&
          error.message === "recoveryStorageError"
        ) &&
        !(error instanceof GaslessServiceError && !error.requestSent)
      )
        throw new GaslessError("unknown");
      throw error;
    }
  });
}
