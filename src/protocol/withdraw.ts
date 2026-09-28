import type { Address } from "viem";
import type { ProtocolPort } from "./port";
import type { ResolvedConfig } from "../core/config";
import { accountCall, type AccountState } from "./account";
import { invariant } from "../core/errors";
import { buildWithdrawIntent, buildWithdrawTypedData } from "./withdraw-intent";
export interface WithdrawPlan {
  requestedAmount: bigint;
  netPayoutAmount: bigint;
  mandatoryDebtReturn: bigint;
  pnlFeeAmount: bigint;
  gasChargeSettledAmount: bigint;
}
export async function quoteWithdrawal(
  port: ProtocolPort,
  s: Pick<AccountState, "account" | "balances">,
  amount?: bigint,
) {
  const claimable = await port.read<bigint>(
    accountCall(s.account, "previewSafeUserClaimablePrimaryDirect", [0]),
  );
  const feasible =
    s.balances.evm + (s.balances.spot > 5000n ? s.balances.spot - 5000n : 0n);
  const maximum = claimable < feasible ? claimable : feasible;
  const plan = amount
    ? await port.read<WithdrawPlan>(
        accountCall(s.account, "previewWithdrawPlanPrimaryDirect", [0, amount]),
      )
    : undefined;
  if (amount)
    invariant(
      amount <= maximum &&
        plan?.requestedAmount === amount &&
        plan.netPayoutAmount > 0n &&
        plan.netPayoutAmount <= amount,
      "WITHDRAW_RESTRICTED",
      "Amount exceeds the current withdrawable balance or is restricted by account debt.",
    );
  return { maximum, plan };
}
export async function withdraw(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  amount: bigint,
  minimum: bigint,
) {
  const { plan } = await quoteWithdrawal(port, s, amount);
  invariant(
    minimum > 0n && plan!.netPayoutAmount >= minimum,
    "WITHDRAW_QUOTE_CHANGED",
    "Withdrawal proceeds changed. Review a new quote before submitting.",
  );
  invariant(
    s.balances.evm >= amount,
    "EVM_BALANCE_REQUIRED",
    "Wait for Core funds to arrive in Trade EVM.",
  );
  const intent = buildWithdrawIntent({
    account: s.account,
    user: owner,
    projectId: s.projectId,
    nonce: s.nonce + 1n,
    requestedAmount: amount,
    minPayoutAmount: minimum,
    withdrawRecipient: owner,
  });
  const signature = await port.sign(
    buildWithdrawTypedData(intent, config.chain.id, s.account),
  );
  await port.write(accountCall(s.account, "withdraw", [intent, signature]));
}
