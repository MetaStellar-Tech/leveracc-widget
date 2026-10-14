import { readTradeWithdrawalBalance } from "./trade-withdrawal-balance";
import type { Address } from "viem";
import type { OperationRecord, Stage } from "../types";
import type { ProtocolPort } from "./port";
import type { ResolvedConfig } from "../core/config";
import { type AccountState } from "./account";
import { ILeverAccRegistryABI } from "../abi/ILeverAccRegistry";
import { ILeverAccL1ReadAdapterABI } from "../abi/ILeverAccL1ReadAdapter";
import { ICoreDepositWalletLikeABI } from "../abi/ICoreDepositWalletLike";
import { IERC20ABI } from "../abi/IERC20";
import { invariant } from "../core/errors";
import { withdraw } from "./withdraw";
import { transfer } from "./funds";
import { formatAmount } from "../core/amount";

export const CORE_DUST = 5_000n,
  ACTIVATION_FEE = 1_000_000n;
export const coreTransferable = (amount: bigint) =>
  amount > CORE_DUST ? amount - CORE_DUST : 0n;
export function withdrawalPlan(amount: bigint, evm: bigint, spot: bigint) {
  const topup = amount > evm ? amount - evm : 0n;
  return {
    topup,
    maximum: evm + coreTransferable(spot),
    feasible: amount > 0n && topup <= coreTransferable(spot),
  };
}
export async function readOwnerCore(
  port: ProtocolPort,
  registry: Address,
  address: Address,
) {
  const adapter = await port.read<Address>({
    address: registry,
    abi: ILeverAccRegistryABI,
    functionName: "l1ReadAdapter",
  });
  const [exists, balance] = await Promise.all([
    port.read<boolean>({
      address: adapter,
      abi: ILeverAccL1ReadAdapterABI,
      functionName: "readCoreUserExists",
      args: [address],
    }),
    port.read<{ total: bigint; hold: bigint }>({
      address: adapter,
      abi: ILeverAccL1ReadAdapterABI,
      functionName: "readCoreSpotBalanceState",
      args: [address, 0n],
    }),
  ]);
  return {
    exists,
    total: balance.total / 100n,
    available: (balance.total - balance.hold) / 100n,
  };
}
export async function prepareAccountTransfer(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  direction: "fundToTrade" | "accountToFund",
  amount: bigint,
  liveCore = false,
): Promise<NonNullable<OperationRecord["transferFlow"]>> {
  const target = await readOwnerCore(port, s.registry, s.account);
  const base = {
    direction,
    amount: amount.toString(),
    relay: false,
    baseline: "0",
    minimum: amount.toString(),
    recipientBaseline: target.total.toString(),
    topup: "0",
    completedHashes: [],
  };
  if (direction === "accountToFund") {
    const balance = liveCore
      ? await readTradeWithdrawalBalance(port, s.account)
      : undefined;
    if (balance)
      invariant(
        amount > 0n && amount <= balance.maximum,
        "WITHDRAW_RESTRICTED",
        config.locale === "zh"
          ? "金额超过合约当前允许的可转余额（已计入债务、仓位限制及利息预留）。"
          : "Amount exceeds the contract withdrawable balance after debt, position limits and interest reserves.",
      );
    const plan = withdrawalPlan(
      amount + (balance?.interest ?? 0n),
      balance?.evm ?? s.balances.evm,
      balance?.core ?? s.balances.spot,
    );
    invariant(
      plan.feasible,
      "INSUFFICIENT_BALANCE",
      "Insufficient Trade balance after reserving Core dust.",
    );
    return {
      ...base,
      step: plan.topup ? "topup" : "withdraw",
      topup: plan.topup.toString(),
      baseline: s.balances.evm.toString(),
    };
  }
  invariant(
    amount <= s.balances.fund,
    "INSUFFICIENT_BALANCE",
    "Insufficient Fund USDC balance.",
  );
  const relay = !target.exists;
  const destination = relay
    ? await readOwnerCore(port, s.registry, owner)
    : target;
  if (liveCore && relay)
    destination.available = await port.coreSpotBalance(owner);
  invariant(
    !relay || destination.exists,
    "CORE_ACTIVATION_REQUIRED",
    "Activate the owner Core account before funding a new Trade Core account.",
  );
  invariant(
    !relay ||
      (amount > ACTIVATION_FEE &&
        destination.available >= ACTIVATION_FEE + CORE_DUST),
    "CORE_RESERVE_REQUIRED",
    "Keep at least 1.005 USDC in owner Core and transfer more than 1 USDC for initial activation.",
  );
  const allowance = await port.read<bigint>({
    address: s.asset,
    abi: IERC20ABI,
    functionName: "allowance",
    args: [owner, config.coreDepositWallet],
  });
  return {
    ...base,
    relay,
    baseline: destination.total.toString(),
    minimum: (amount - (relay ? ACTIVATION_FEE : 0n)).toString(),
    step: allowance < amount ? "approval" : "deposit",
  };
}
/** Submit exactly one user-authorized step, checking current prerequisites. */
export async function executeAccountTransfer(
  port: ProtocolPort,
  config: ResolvedConfig,
  owner: Address,
  s: AccountState,
  flow: NonNullable<OperationRecord["transferFlow"]>,
) {
  const amount = BigInt(flow.amount);
  const withdrawal =
    flow.submission && flow.direction === "accountToFund"
      ? await readTradeWithdrawalBalance(port, s.account)
      : undefined;
  if (withdrawal)
    invariant(
      amount > 0n && amount <= withdrawal.maximum,
      "WITHDRAW_RESTRICTED",
      config.locale === "zh"
        ? "金额超过合约当前允许的可转余额，请重新检查债务和仓位限制。"
        : "Amount exceeds the current contract withdrawable balance. Review debt and position limits.",
    );
  const required = amount + (withdrawal?.interest ?? 0n);
  const availableEvm = withdrawal?.evm ?? s.balances.evm;
  switch (flow.step) {
    case "approval":
      if (
        (await port.read<bigint>({
          address: s.asset,
          abi: IERC20ABI,
          functionName: "allowance",
          args: [owner, config.coreDepositWallet],
        })) >= amount
      ) {
        flow.step = "deposit";
        return;
      }
      await port.write({
        address: s.asset,
        abi: IERC20ABI,
        functionName: "approve",
        args: [config.coreDepositWallet, amount],
      });
      break;
    case "deposit": {
      invariant(
        (await port.read<bigint>({
          address: s.asset,
          abi: IERC20ABI,
          functionName: "allowance",
          args: [owner, config.coreDepositWallet],
        })) >= amount,
        "APPROVAL_REQUIRED",
        "Approval is not available yet. Try continuing again later.",
      );
      invariant(
        s.balances.fund >= amount,
        "INSUFFICIENT_BALANCE",
        "Insufficient Fund USDC balance.",
      );
      await port.write({
        address: config.coreDepositWallet,
        abi: ICoreDepositWalletLikeABI,
        functionName: "depositFor",
        args: [flow.relay ? owner : s.account, amount, 4294967295],
      });
      break;
    }
    case "relay": {
      const source = await readOwnerCore(port, s.registry, owner);
      if (flow.submission) source.available = await port.coreSpotBalance(owner);
      invariant(
        source.available >= amount + ACTIVATION_FEE + CORE_DUST,
        "CORE_RESERVE_REQUIRED",
        "Owner Core balance must cover the transfer and activation reserve.",
      );
      await port.sendCore(s.account, formatAmount(amount));
      break;
    }
    case "topup": {
      const shortfall = required > availableEvm ? required - availableEvm : 0n;
      const spareCore = withdrawal
        ? coreTransferable(withdrawal.core) - shortfall
        : 0n;
      const buffer =
        shortfall > 0n &&
        withdrawal &&
        withdrawal.interest > 0n &&
        spareCore > 0n
          ? spareCore < CORE_DUST
            ? spareCore
            : CORE_DUST
          : 0n;
      flow.baseline = availableEvm.toString();
      flow.topup = (shortfall + buffer).toString();
      if (flow.topup === "0") {
        flow.step = "withdraw";
        return;
      }
      await transfer(port, config, owner, s, "coreToEvm", BigInt(flow.topup));
      break;
    }
    case "withdraw":
      invariant(
        availableEvm >= required,
        "EVM_BALANCE_REQUIRED",
        "Trade EVM balance is not sufficient yet. Try continuing again later.",
      );
      if (flow.withdrawMinimum) {
        await withdraw(
          port,
          config,
          owner,
          s,
          amount,
          BigInt(flow.withdrawMinimum),
        );
      } else await transfer(port, config, owner, s, "tradeToFund", amount);
  }
}
/** Advance in memory immediately after submission; never query receipts or arrival. */
export function advanceAccountTransfer(op: OperationRecord): Stage {
  const flow = op.transferFlow!;
  if (op.hash) flow.completedHashes.push(op.hash);
  if (flow.step === "approval") flow.step = "deposit";
  else if (flow.step === "topup") flow.step = "withdraw";
  else if (flow.step === "deposit" && flow.relay) flow.step = "relay";
  else return "submitted";
  return "awaitingAction";
}
