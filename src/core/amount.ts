import { formatUnits, parseUnits } from "viem";
import { invariant } from "./errors";
export const MAX_AMOUNT = (1n << 128n) - 1n;
export function parseAmount(value: string): bigint {
  invariant(
    /^\d+(?:\.\d{1,6})?$/.test(value.trim()),
    "INVALID_AMOUNT",
    "Enter a USDC amount with up to 6 decimals.",
  );
  const n = parseUnits(value.trim(), 6);
  invariant(
    n > 0n && n <= MAX_AMOUNT,
    "INVALID_AMOUNT",
    "Amount must be positive and within the protocol limit.",
  );
  return n;
}
export const formatAmount = (n: bigint) => formatUnits(n, 6);
export function coreAmount(value: string): bigint {
  invariant(
    /^\d+(?:\.\d{1,8})?$/.test(value),
    "INVALID_BALANCE",
    "Invalid Core balance.",
  );
  return parseUnits(value, 8) / 100n;
}
export function repayCeiling(debt: bigint): bigint {
  const value = debt + (debt * 10n + 9999n) / 10000n;
  return value > MAX_AMOUNT ? MAX_AMOUNT : value;
}

/** Match the dapp's preview allowance for partial and full repayment. */
export function repayRequestAmount(
  entered: bigint,
  debt: bigint,
  full: boolean,
): bigint {
  const base = full && debt > entered ? debt : entered;
  const value = base + (entered * 10n + 9999n) / 10000n;
  return value > MAX_AMOUNT ? MAX_AMOUNT : value;
}

/** Leave headroom for changes between the withdrawal quote and submission. */
export function accountTransferMax(withdrawable: bigint): bigint {
  if (withdrawable <= 0n) return 0n;
  const proportional = (withdrawable + 999n) / 1000n;
  const reserve = proportional > 5_000n ? proportional : 5_000n;
  return withdrawable > reserve ? withdrawable - reserve : 0n;
}
