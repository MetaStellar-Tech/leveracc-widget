import { hashTypedData, parseSignature, parseUnits, type Hex } from "viem";
import type { GaslessConfig } from "./gasless-service";
import type {
  GaslessPair,
  GaslessPayload,
  GaslessQuote,
  SignedGaslessPayload,
} from "./gasless-api";
import { ARBITRUM_USDC as ARBITRUM_NATIVE_USDC } from "./gas-funding";

export const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export class GaslessError extends Error {}
const same = (a: unknown, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

export function gaslessLimits(config: GaslessConfig | undefined) {
  const c = config?.gasless;
  if (
    !c?.enabled ||
    c.source_chain_id !== 42161 ||
    !/^\d+$/.test(c.min_sell_amount_raw) ||
    !/^\d+$/.test(c.max_sell_amount_raw)
  )
    return null;
  const min =
    BigInt(c.min_sell_amount_raw) > BigInt(200000)
      ? BigInt(c.min_sell_amount_raw)
      : BigInt(200000);
  const max = BigInt(c.max_sell_amount_raw);
  return max >= min ? { min, max } : null;
}
export function gaslessAmount(
  value: string,
  limits: ReturnType<typeof gaslessLimits>,
  usdc: bigint,
  reserve: bigint,
) {
  if (!limits) throw new GaslessError("unavailable");
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new GaslessError("amountInvalid");
  const amount = parseUnits(value, 6);
  if (amount < limits.min || amount > limits.max)
    throw new GaslessError("amountInvalid");
  if (amount + reserve > usdc) throw new GaslessError("reserveInsufficient");
  return amount;
}
export function prepareMessage(
  owner: string,
  amount: bigint,
  timestamp: number,
) {
  return `LeverAcc Gasless Prepare\nChain: 42161\nWallet: ${owner.toLowerCase()}\nSellToken: ${ARBITRUM_NATIVE_USDC.toLowerCase()}\nSellAmount: ${amount}\nTimestamp: ${timestamp}`;
}
export function signedGasless(
  payload: GaslessPayload,
  signature: Hex,
): SignedGaslessPayload {
  const { r, s, v, yParity } = parseSignature(signature);
  return {
    ...payload,
    signature: {
      signatureType: 2,
      r,
      s,
      v: v === undefined ? 27 + yParity! : Number(v),
    },
  };
}
export function assertQuoteFresh(quote: GaslessQuote, now = Date.now()) {
  if (
    !Number.isFinite(Date.parse(quote.expires_at)) ||
    Date.parse(quote.expires_at) <= now
  )
    throw new GaslessError("quoteExpired");
}
export function validateGaslessQuote(
  q: GaslessQuote,
  owner: string,
  amount: bigint,
  deficit: bigint,
) {
  const invalid = () => {
    throw new GaslessError("quoteInvalid");
  };
  // Never allow unsafe JSON numbers to silently change signed integers.
  const safeNumbers = (v: unknown): boolean =>
    typeof v === "number"
      ? Number.isSafeInteger(v)
      : v !== null && typeof v === "object"
        ? Object.values(v).every(safeNumbers)
        : true;
  try {
    if (
      !safeNumbers(q) ||
      q.provider !== "0x" ||
      q.source_chain_id !== 42161 ||
      !same(q.user_eoa, owner) ||
      !same(q.sell_token, ARBITRUM_NATIVE_USDC) ||
      !same(q.buy_token, NATIVE_ETH) ||
      !q.liquidity_available ||
      !q.quote_token ||
      !/^0x[\da-f]{64}$/i.test(q.trade_hash) ||
      BigInt(q.sell_amount_raw) <= BigInt(0) ||
      BigInt(q.sell_amount_raw) > amount
    )
      invalid();
    const trade = q.zeroex_quote.trade;
    const permitted = trade.eip712.message.permitted as {
      token: string;
      amount: string;
    };
    const slippage = trade.eip712.message.slippageAndActions as {
      recipient: string;
      buyToken: string;
      minAmountOut: string;
    };
    if (
      trade.type !== "settler_metatransaction" ||
      Number(trade.eip712.domain.chainId) !== 42161 ||
      !same(permitted.token, ARBITRUM_NATIVE_USDC) ||
      BigInt(permitted.amount) < BigInt(q.sell_amount_raw) ||
      BigInt(permitted.amount) > amount ||
      !same(slippage.recipient, owner) ||
      !same(slippage.buyToken, NATIVE_ETH) ||
      String(slippage.minAmountOut) !== q.min_buy_amount_raw ||
      !same(hashTypedData(trade.eip712), q.trade_hash)
    )
      invalid();
    const approval = q.zeroex_quote.approval;
    if (
      approval &&
      (approval.type !== "permit" ||
        Number(approval.eip712.domain.chainId) !== 42161 ||
        !same(approval.eip712.domain.verifyingContract, ARBITRUM_NATIVE_USDC) ||
        !same(approval.eip712.message.owner, owner) ||
        !same(
          approval.eip712.message.spender,
          trade.eip712.domain.verifyingContract!,
        ))
    )
      invalid();
  } catch {
    invalid();
  }
  assertQuoteFresh(q);
  if (
    !/^\d+$/.test(q.min_buy_amount_raw) ||
    BigInt(q.min_buy_amount_raw) <= BigInt(0) ||
    BigInt(q.min_buy_amount_raw) < deficit
  )
    throw new GaslessError("outputInsufficient");
}

export type GaslessOperation = GaslessPair & {
  version: 1;
  owner: string;
  network: number;
  stage: "prepared" | "submitted" | "success" | "failed";
  createdAt: number;
  ethBefore: string;
  amount: string;
};
export function readGaslessOperation(
  raw: string | null,
  owner: string,
  network: number,
): GaslessOperation | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as GaslessOperation;
    if (
      v.version !== 1 ||
      !same(v.owner, owner) ||
      v.network !== network ||
      !/^0x[\da-f]{64}$/i.test(v.trade_hash) ||
      typeof v.quote_token !== "string" ||
      !v.quote_token ||
      !["prepared", "submitted", "success", "failed"].includes(v.stage) ||
      !Number.isFinite(v.createdAt) ||
      !/^\d+$/.test(v.ethBefore) ||
      !/^\d+$/.test(v.amount)
    )
      throw new Error();
    return v;
  } catch {
    throw new GaslessError("storageError");
  }
}
