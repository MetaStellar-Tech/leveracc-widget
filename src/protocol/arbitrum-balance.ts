import type { Network } from "../types";
import type { Address } from "viem";
import { cctpDeployment } from "../bridge/cctp";
import { invariant } from "../core/errors";
import { accountCall, same, type RuntimeStatus } from "./account";
import { coreTransferable } from "./account-transfer";
import type { ProtocolPort } from "./port";

export async function readArbitrumTradeBalance(
  port: ProtocolPort,
  account: Address,
  asset: Address,
  network: Network = "mainnet",
) {
  invariant(
    same(asset, cctpDeployment(network).evmUsdc),
    "UNSUPPORTED_ASSET",
    "Unsupported withdrawal asset.",
  );
  const [runtime, core, safe] = await Promise.all([
    port.read<RuntimeStatus>(accountCall(account, "getAccountRuntimeStatus")),
    port.coreSpotBalance(account),
    port.read<bigint>(
      accountCall(account, "previewSafeUserClaimablePrimaryDirect", [0]),
    ),
  ]);
  invariant(
    typeof runtime.payableInterestNow === "bigint",
    "INVALID_BALANCE",
    "Withdrawal interest is unavailable.",
  );
  const evm = runtime.availableAssetBalance;
  const interest = runtime.payableInterestNow;
  const liquid = evm + coreTransferable(core);
  const ceiling = liquid > interest ? liquid - interest : 0n;
  const maximum = safe < ceiling ? safe : ceiling;
  return { evm, core, interest, maximum: maximum > 0n ? maximum : 0n };
}

export function arbitrumWithdrawalTopup(
  balance: Awaited<ReturnType<typeof readArbitrumTradeBalance>>,
  amount: bigint,
) {
  invariant(
    amount > 0n && amount <= balance.maximum,
    "WITHDRAW_RESTRICTED",
    "Amount exceeds the current withdrawable balance.",
  );
  const required = amount + balance.interest;
  return required > balance.evm ? required - balance.evm : 0n;
}
