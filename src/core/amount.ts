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
