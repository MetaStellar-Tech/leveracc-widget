import type { Address } from "viem";
import type { OperationRecord, Stage } from "../types";
import type { ResolvedConfig } from "../core/config";
import type { ProtocolPort } from "./port";
import { accountCall, readAccount, type AccountState } from "./account";
import {
  executeAccountTransfer,
  ACTIVATION_FEE,
  CORE_DUST,
} from "./account-transfer";
import { invariant, normalizeError } from "../core/errors";
import { boundedRead, waitUntil } from "./transaction-wait";
import { IERC20ABI } from "../abi/IERC20";

export async function transferState(
  port: ProtocolPort,
  s: AccountState,
): Promise<AccountState> {
  return {
    ...s,
    balances: { ...s.balances, spot: await port.coreSpotBalance(s.account) },
  };
}

/** Confirm intermediate funding and automatically continue Trade-to-Fund withdrawal. */
async function runAccountTransfer(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  initial: AccountState,
  op: OperationRecord,
  progress: (stage: Stage) => void,
) {
  const flow = op.transferFlow!;
  const tracking = flow.submission!;
  const amount = BigInt(flow.amount);
  const message = (en: string, zh: string) =>
    config.locale === "zh" ? zh : en;
  invariant(
    tracking.phase !== "unknown",
    "SUBMISSION_UNKNOWN",
    message(
      "Submission result is unknown. Check your wallet before another transfer.",
      "提交结果未知，请先检查钱包中的交易。",
    ),
  );
  invariant(
    port.waitForReceipt && port.pause,
    "UNSUPPORTED_PORT",
    "Transaction confirmation support is required.",
  );
  const ready = async () => {
    if (tracking.pendingStep === "approval")
      return (
        (await port.read<bigint>({
          address: initial.asset,
          abi: IERC20ABI,
          functionName: "allowance",
          args: [owner, config.coreDepositWallet],
        })) >= amount
      );
    if (tracking.pendingStep === "deposit")
      return (
        (await port.coreSpotBalance(owner)) >=
        amount + ACTIVATION_FEE + CORE_DUST
      );
    const runtime = await port.read<{ availableAssetBalance: bigint }>(
      accountCall(initial.account, "getAccountRuntimeStatus", []),
    );
    // Arrival has a fixed funding target; interest is revalidated before signing.
    return (
      runtime.availableAssetBalance >=
      BigInt(flow.baseline) + BigInt(flow.topup)
    );
  };
  const check = async (poll: boolean) => {
    const deadline = Date.now() + 90_000;
    tracking.phase = "waiting";
    progress("preparing");
    try {
      const receipt = await boundedRead(
        () => port.waitForReceipt!(tracking.hash!, deadline - Date.now()),
        deadline - Date.now(),
      );
      if (receipt === "reverted") {
        delete tracking.hash;
        delete tracking.pendingStep;
        tracking.phase = "ready";
        invariant(
          false,
          "TRANSFER_REVERTED",
          message(
            "Intermediate transaction reverted. Retry to recalculate the transfer.",
            "中间交易已回滚，重试时将重新计算转账。",
          ),
        );
      }
      if (poll) await waitUntil(port, ready, deadline);
      else
        invariant(
          await boundedRead(ready, deadline - Date.now()),
          "TRANSFER_NOT_READY",
          message(
            "Intermediate funds are not available yet. Check again shortly.",
            "中间资金尚未到账，请稍后再次检查。",
          ),
        );
      flow.step =
        tracking.pendingStep === "approval"
          ? "deposit"
          : tracking.pendingStep === "deposit"
            ? "relay"
            : "withdraw";
      delete tracking.pendingStep;
      delete tracking.hash;
      tracking.phase = "ready";
    } catch (error) {
      if (tracking.hash) tracking.phase = "check";
      throw error;
    }
  };
  if (tracking.phase === "check") {
    await check(false);
    if (flow.direction !== "accountToFund") {
      progress("awaitingAction");
      return;
    }
  }
  await port.checkContext?.();
  let s = await transferState(
    port,
    await readAccount(port, config, owner, initial.account),
  );
  while (true) {
    if (flow.direction === "accountToFund") {
      const plan = await port.read<{
        requestedAmount: bigint;
        netPayoutAmount: bigint;
      }>(
        accountCall(s.account, "previewWithdrawPlanPrimaryDirect", [0, amount]),
      );
      invariant(
        plan.requestedAmount === amount && plan.netPayoutAmount === amount,
        "WITHDRAW_RESTRICTED",
        message(
          "The requested transfer cannot be paid in full.",
          "当前限制不允许足额转出该金额。",
        ),
      );
    }
    const step = flow.step;
    delete op.hash;
    progress("preparing");
    let submitted = false;
    try {
      await executeAccountTransfer(
        {
          ...port,
          write: async (call) => {
            const hash = await port.write(call);
            submitted = true;
            flow.completedHashes.push(hash);
            if (
              step === "approval" ||
              step === "topup" ||
              (step === "deposit" && flow.relay)
            ) {
              tracking.hash = hash;
              tracking.pendingStep = step;
            }
            return hash;
          },
          sendCore: async (destination, value) => {
            await port.sendCore(destination, value);
            submitted = true;
          },
        },
        config,
        owner,
        s,
        flow,
      );
    } catch (error) {
      if (op.stage === "submitting" && !definitelyRejected(error))
        tracking.phase = "unknown";
      throw error;
    }
    if (!submitted) continue; // Fresh allowance or EVM balance already satisfies this step.
    if (!tracking.hash) {
      tracking.phase = "submitted";
      return;
    }
    await check(true);
    if (step !== "approval" && step !== "topup") {
      progress("awaitingAction");
      return;
    }
    // Continue with fresh identity, limits and balances after approval or Core funding.
    await port.checkContext?.();
    s = await transferState(
      port,
      await readAccount(port, config, owner, s.account),
    );
  }
}

function definitelyRejected(error: unknown): boolean {
  if (normalizeError(error).code === "USER_REJECTED") return true;
  let current = error;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === "object";
    depth++
  ) {
    if (
      "name" in current &&
      [
        "ContractFunctionRevertedError",
        "ExecutionRevertedError",
        "ApiRequestError",
        "InsufficientFundsError",
      ].includes(String(current.name))
    )
      return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
export async function submitAccountTransfer(
  ...args: Parameters<typeof runAccountTransfer>
) {
  try {
    await runAccountTransfer(...args);
  } catch (error) {
    if (args[1].locale === "zh") {
      const normalized = normalizeError(error);
      if (normalized.code === "TRANSACTION_WAIT_TIMEOUT")
        normalized.message =
          "中间交易确认或到账超时，请检查资金到账，不会重复提交。";
      if (normalized.code === "USER_REJECTED")
        normalized.message = "已取消钱包请求，可重试当前划转步骤。";
      throw normalized;
    }
    throw error;
  }
}
