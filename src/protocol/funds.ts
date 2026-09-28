import { keccak256, toBytes, type Address } from "viem";
import type { ProtocolPort } from "./port";
import type { ResolvedConfig } from "../core/config";
import { accountCall, same, type AccountState } from "./account";
import { ILeverAccRegistryABI } from "../abi/ILeverAccRegistry";
import { ILeverAccEconomicConfigABI } from "../abi/ILeverAccEconomicConfig";
import { IERC20ABI } from "../abi/IERC20";
import { invariant } from "../core/errors";
import { parseAmount, repayCeiling } from "../core/amount";
import { buildBorrowIntent, buildBorrowTypedData } from "./borrow-intent";
import { buildRepayIntent, buildRepayTypedData } from "./repay-intent";
import { buildWithdrawIntent, buildWithdrawTypedData } from "./withdraw-intent";
import type { TransferRoute } from "../types";
export async function borrow(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  amount: bigint,
  reasons: string[],
  reviewedVersion?: bigint,
) {
  invariant(
    reasons.length === 0,
    "ACCOUNT_ACTION_REQUIRED",
    "Complete the account setup in the host application before borrowing.",
  );
  invariant(
    same(s.projectId, config.projectId) &&
      s.capacity.blockerCode === 0 &&
      !s.capacity.borrowPaused,
    "BORROW_BLOCKED",
    "Borrowing is currently blocked.",
  );
  invariant(
    amount <= s.capacity.finalAdditionalBorrowAllowed,
    "BORROW_LIMIT",
    "Amount exceeds the current borrowing limit.",
  );
  const [minimum, maximum] = await port.read<readonly bigint[]>({
    address: s.registry,
    abi: ILeverAccRegistryABI,
    functionName: "effectiveBorrowRiskConfig",
    args: [s.account],
  });
  invariant(
    amount >= minimum && (maximum === 0n || amount <= maximum),
    "BORROW_LIMIT",
    "Amount is outside the protocol borrowing limits.",
  );
  const economic = await port.read<Address>({
    address: s.registry,
    abi: ILeverAccRegistryABI,
    functionName: "economicConfig",
  });
  const rate = await port.read<{ version: bigint }>({
    address: economic,
    abi: ILeverAccEconomicConfigABI,
    functionName: "getCurrentBorrowRate",
    args: [0n, keccak256(toBytes("leveracc.borrow.margin"))],
  });
  invariant(
    rate.version > 0n,
    "PRICING_UNAVAILABLE",
    "Borrow pricing is not initialized.",
  );
  invariant(
    reviewedVersion === undefined || reviewedVersion === rate.version,
    "RATE_CHANGED",
    "Borrow pricing changed. Review the updated rate before signing.",
  );
  const intent = buildBorrowIntent({
    account: s.account,
    user: owner,
    projectId: config.projectId,
    nonce: s.nonce + 1n,
    borrowAmount: amount,
    termSeconds: config.borrow.termSeconds,
    lotFactorPpm: 1_000_000_000,
    maxCoreReturnFee: parseAmount(config.borrow.maxCoreReturnFeeUsdc),
    expectedBorrowRateVersion: rate.version,
    expiryWindowSeconds: config.borrow.expiryWindowSeconds,
  });
  const signature = await port.sign(
    buildBorrowTypedData(intent, config.chain.id, s.account),
  );
  await port.write(accountCall(s.account, "borrow", [intent, signature]));
}
export async function repay(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  amount: bigint,
  full: boolean,
) {
  invariant(
    s.bindingEpoch > 0n,
    "PROJECT_BINDING_REQUIRED",
    "Complete project binding before repaying.",
  );
  const ceiling = full ? repayCeiling(s.runtime.totalRealtimeDebtNow) : amount;
  const preview = await port.read<{ repayableAmount: bigint }>(
    accountCall(s.account, "previewRepay", [ceiling, false]),
  );
  invariant(
    preview.repayableAmount > 0n,
    "NO_DEBT",
    "No outstanding debt to repay.",
  );
  invariant(
    s.balances.evm >= preview.repayableAmount,
    "EVM_BALANCE_REQUIRED",
    "Move USDC from Core to Trade EVM before repaying.",
  );
  const intent = buildRepayIntent({
    account: s.account,
    user: owner,
    projectId: s.projectId,
    nonce: s.nonce + 1n,
    requestedRepayAmount: ceiling,
    expiryWindowSeconds: config.borrow.expiryWindowSeconds,
  });
  const signature = await port.sign(
    buildRepayTypedData(intent, config.chain.id, s.account),
  );
  await port.write(accountCall(s.account, "repay", [intent, signature]));
}
export async function deposit(
  port: ProtocolPort,
  owner: Address,
  s: AccountState,
  amount: bigint,
) {
  invariant(
    amount <= s.balances.fund,
    "INSUFFICIENT_BALANCE",
    "Insufficient Fund USDC balance.",
  );
  await port.write({
    address: s.asset,
    abi: IERC20ABI,
    functionName: "transfer",
    args: [s.account, amount],
  });
}
export async function transfer(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  route: Exclude<
    TransferRoute,
    "tradeToArbitrum" | "fundToArbitrum" | "fundToTrade" | "accountToFund"
  >,
  amount: bigint,
) {
  const available =
    route === "coreToEvm" || route === "spotToPerps"
      ? s.balances.spot > 5000n
        ? s.balances.spot - 5000n
        : 0n
      : route === "perpsToSpot"
        ? s.balances.perps
        : s.balances.evm;
  invariant(
    amount <= available,
    "INSUFFICIENT_BALANCE",
    "Insufficient available balance for this route.",
  );
  if (route === "tradeToFund") {
    const plan = await port.read<{ netPayoutAmount: bigint }>(
      accountCall(s.account, "previewWithdrawPlanPrimaryDirect", [0, amount]),
    );
    invariant(
      plan.netPayoutAmount === amount,
      "WITHDRAW_RESTRICTED",
      "The withdrawal amount is restricted. Review your debt and available funds.",
    );
    const intent = buildWithdrawIntent({
      account: s.account,
      user: owner,
      projectId: s.projectId,
      nonce: s.nonce + 1n,
      requestedAmount: amount,
      minPayoutAmount: amount,
      withdrawRecipient: owner,
    });
    const signature = await port.sign(
      buildWithdrawTypedData(intent, config.chain.id, s.account),
    );
    await port.write(accountCall(s.account, "withdraw", [intent, signature]));
    return;
  }
  await port.write(
    accountCall(
      s.account,
      route === "evmToCore"
        ? "moveEvmUsdcToCoreForSelf"
        : route === "coreToEvm"
          ? "sendCoreSpotToEvm"
          : "sendCoreUsdClassTransfer",
      route === "evmToCore"
        ? [amount]
        : route === "coreToEvm"
          ? [0n, amount]
          : [amount, route === "spotToPerps"],
    ),
  );
}

export async function readBorrowRate(
  port: ProtocolPort,
  s: Pick<AccountState, "registry">,
) {
  const address = await port.read<Address>({
    address: s.registry,
    abi: ILeverAccRegistryABI,
    functionName: "economicConfig",
  });
  return port.read<{ version: bigint; dailyRatePpm: number }>({
    address,
    abi: ILeverAccEconomicConfigABI,
    functionName: "getCurrentBorrowRate",
    args: [0n, keccak256(toBytes("leveracc.borrow.margin"))],
  });
}
