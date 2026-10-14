import type { Address } from "viem";
import { invariant } from "../core/errors";
import { accountCall, type RuntimeStatus } from "./account";
import type { ProtocolPort } from "./port";

export async function readTradeWithdrawalBalance(
  port: ProtocolPort,
  account: Address,
) {
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
  invariant(
    typeof safe === "bigint" &&
      typeof runtime.availableAssetBalance === "bigint",
    "INVALID_BALANCE",
    "Contract withdrawable balance is unavailable.",
  );
  const evm = runtime.availableAssetBalance;
  const interest = runtime.payableInterestNow;
  const liquid = evm + (core > 5_000n ? core - 5_000n : 0n);
  const ceiling = liquid > interest ? liquid - interest : 0n;
  const maximum = safe < ceiling ? safe : ceiling;
  return { evm, core, interest, maximum: maximum > 0n ? maximum : 0n };
}
