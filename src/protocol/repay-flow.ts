import { boundedRead } from "./transaction-wait";
import type { Address } from "viem";
import type { OperationRecord, Stage } from "../types";
import type { ResolvedConfig } from "../core/config";
import { invariant, normalizeError } from "../core/errors";
import { repayRequestAmount } from "../core/amount";
import { accountCall, readAccount, type AccountState } from "./account";
import { coreTransferable } from "./account-transfer";
import { repay, transfer } from "./funds";
import type { ProtocolPort } from "./port";

export const repayAvailable = (evm: bigint, spot: bigint, debt: bigint) => {
  const funds = evm + coreTransferable(spot);
  return funds < debt ? funds : debt;
};

/** Keep submitted top-ups in memory so retries never send them twice. */
async function runRepayment(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  state: AccountState,
  op: OperationRecord,
  amount: bigint,
  full: boolean,
  progress: (stage: Stage) => void,
) {
  let s = state;
  invariant(
    s.bindingEpoch > 0n,
    "PROJECT_BINDING_REQUIRED",
    "Complete project binding before repaying.",
  );
  if (!op.repayFlow) {
    invariant(
      amount > 0n && (full || amount <= s.balances.debt),
      "INVALID_AMOUNT",
      "Repay amount exceeds current debt or is zero.",
    );
    const ceiling = repayRequestAmount(
      amount,
      s.runtime.totalRealtimeDebtNow,
      full,
    );
    const preview = await port.read<{ repayableAmount: bigint }>(
      accountCall(s.account, "previewRepay", [ceiling, false]),
    );
    invariant(
      preview.repayableAmount > 0n,
      "NO_DEBT",
      "No outstanding debt to repay.",
    );
    // Full repayment must retain the allowance through funding and signing.
    // Capping it by preview debt here would leave newly accrued interest unpaid.
    const target = full
      ? ceiling
      : preview.repayableAmount < ceiling
        ? preview.repayableAmount
        : ceiling;
    invariant(
      target <= s.balances.evm + coreTransferable(s.balances.spot),
      "INSUFFICIENT_BALANCE",
      "Insufficient EVM and available Core USDC after reserving 0.005 USDC.",
    );
    op.repayFlow = {
      boundProjectId: s.projectId,
      full,
      amount: target.toString(),
      topup: "0",
      step: "topup",
    };
  }
  const flow = op.repayFlow;
  invariant(
    s.projectId === flow.boundProjectId,
    "CONTEXT_CHANGED",
    "Account project binding changed.",
  );
  invariant(
    !flow.submissionUnknown,
    "SUBMISSION_UNKNOWN",
    "Submission result is unknown. Check your wallet transaction before starting another repayment.",
  );
  const target = BigInt(flow.amount);
  if (flow.step === "topup") {
    const shortfall = target > s.balances.evm ? target - s.balances.evm : 0n;
    invariant(
      shortfall <= coreTransferable(s.balances.spot),
      "INSUFFICIENT_BALANCE",
      "Insufficient available Core USDC after reserving 0.005 USDC.",
    );
    flow.topup = shortfall.toString();
    if (shortfall) {
      invariant(
        port.waitForReceipt && port.pause,
        "UNSUPPORTED_PORT",
        "Repayment requires transaction confirmation support.",
      );
      progress("preparing");
      try {
        // transfer writes exactly once, using the existing simulation and wallet guards.
        await transfer(
          {
            ...port,
            write: async (call) => {
              const hash = await port.write(call);
              flow.topupHash = hash;
              return hash;
            },
          },
          config,
          owner,
          s,
          "coreToEvm",
          shortfall,
        );
      } catch (error) {
        if (
          op.stage === "submitting" &&
          normalizeError(error).code !== "USER_REJECTED"
        )
          flow.submissionUnknown = true;
        throw error;
      }
      flow.step = "confirming";
    } else flow.step = "repay";
  }
  if (flow.step === "confirming") {
    progress("preparing");
    const status = await port.waitForReceipt!(flow.topupHash!);
    if (status === "reverted") {
      flow.step = "topup";
      delete flow.topupHash;
      invariant(
        false,
        "REPAY_TOPUP_REVERTED",
        "Core transfer failed. Retry to recalculate the required amount.",
      );
    }
    flow.step = "arrival";
  }
  if (flow.step === "arrival") {
    progress("preparing");
    const deadline = Date.now() + 90_000;
    while (true) {
      await port.checkContext?.();
      const runtime = await port.read<{ availableAssetBalance: bigint }>(
        accountCall(s.account, "getAccountRuntimeStatus", []),
      );
      if (runtime.availableAssetBalance >= target) break;
      invariant(
        Date.now() < deadline,
        "REPAY_ARRIVAL_TIMEOUT",
        "Core transfer was submitted but EVM funds have not arrived. Retry to check arrival without sending another transfer.",
      );
      await port.pause!(2000);
    }
    flow.step = "repay";
  }
  invariant(
    port.waitForReceipt,
    "UNSUPPORTED_PORT",
    "Transaction confirmation support is required.",
  );
  if (flow.step === "repay") {
    progress("preparing");
    await port.checkContext?.();
    s = await readAccount(port, config, owner, s.account);
    invariant(
      s.projectId === state.projectId,
      "CONTEXT_CHANGED",
      "Account project binding changed.",
    );
    if (flow.full) {
      invariant(
        s.balances.evm >= target,
        "EVM_BALANCE_REQUIRED",
        "Trade EVM must cover the full repayment allowance before signing.",
      );
    }
    delete op.hash;
    try {
      await repay(
        {
          ...port,
          write: async (call) => {
            const hash = await port.write(call);
            flow.repayHash = hash;
            return hash;
          },
        },
        config,
        owner,
        s,
        target,
        false,
      );
      flow.step = "repayConfirming";
    } catch (error) {
      if (
        op.stage === "submitting" &&
        normalizeError(error).code !== "USER_REJECTED"
      )
        flow.submissionUnknown = true;
      throw error;
    }
  }
  if (flow.step === "repayConfirming") {
    op.hash = flow.repayHash;
    progress("confirming");
    const status = await boundedRead(
      () => port.waitForReceipt!(flow.repayHash!),
      90_000,
    );
    if (status === "reverted") {
      flow.step = "repay";
      delete flow.repayHash;
      invariant(
        false,
        "REPAY_REVERTED",
        "Repayment transaction reverted. Retry after checking the current debt and balance.",
      );
    }
    flow.step = "complete";
    progress("success");
  }
}

const repaymentErrorsZh: Record<string, string> = {
  PROJECT_BINDING_REQUIRED: "请先完成项目绑定，再还款。",
  INVALID_AMOUNT: "还款金额必须大于零，且不能超过当前债务。",
  NO_DEBT: "当前没有可偿还的债务。",
  INSUFFICIENT_BALANCE: "预留 Core 的 0.005 USDC 后，可用资金不足。",
  SUBMISSION_UNKNOWN: "提交结果未知。请先检查钱包中的交易，再开始另一笔还款。",
  REPAY_TOPUP_REVERTED: "Core 转账失败。重试时将重新计算所需金额。",
  TRANSACTION_WAIT_TIMEOUT:
    "交易确认或到账仍在等待中，重试将检查已提交交易，不会重复发送。",
  REPAY_REVERTED: "还款交易已回滚，请检查当前债务和余额后重试。",
  REPAY_CONFIRMATION_TIMEOUT:
    "Core 转账仍待确认。重试将检查同一笔交易，不会重复转账。",
  REPAY_ARRIVAL_TIMEOUT:
    "Core 转账已提交，但 EVM 资金尚未到账。重试将检查到账情况，不会重复转账。",
  CONTEXT_CHANGED: "账户或配置已变化，已停止自动还款。",
  OWNER_WALLET_MISMATCH: "连接的钱包账户已变化，已停止自动还款。",
  EVM_BALANCE_REQUIRED: "交易账户 EVM 余额仍不足，请到账后重试。",
  USER_REJECTED: "已取消钱包请求，可重试当前还款步骤。",
};

export async function executeRepayment(
  ...args: Parameters<typeof runRepayment>
) {
  try {
    await runRepayment(...args);
  } catch (error) {
    if (args[1].locale === "zh") {
      const normalized = normalizeError(error);
      normalized.message =
        repaymentErrorsZh[normalized.code] ?? normalized.message;
      throw normalized;
    }
    throw error;
  }
}
