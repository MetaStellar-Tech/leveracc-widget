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
    const plan = withdrawalPlan(amount, s.balances.evm, s.balances.spot);
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
      invariant(
        source.available >= amount + ACTIVATION_FEE + CORE_DUST,
        "CORE_RESERVE_REQUIRED",
        "Owner Core balance must cover the transfer and activation reserve.",
      );
      await port.sendCore(s.account, formatAmount(amount));
      break;
    }
    case "topup":
      flow.topup = (
        amount > s.balances.evm ? amount - s.balances.evm : 0n
      ).toString();
      if (flow.topup === "0") {
        flow.step = "withdraw";
        return;
      }
      await transfer(port, config, owner, s, "coreToEvm", BigInt(flow.topup));
      break;
    case "withdraw":
      invariant(
        s.balances.evm >= amount,
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
