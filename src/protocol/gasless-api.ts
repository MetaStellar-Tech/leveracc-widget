import type { Hex, TypedData, TypedDataDomain } from "viem";
import { gaslessRequest } from "./gasless-service";
import type { ResolvedConfig } from "../core/config";

export type GaslessPayload = {
  type: string;
  eip712: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, unknown>;
  };
};
export type SignedGaslessPayload = GaslessPayload & {
  signature: { signatureType: 2; v: number; r: Hex; s: Hex };
};
export type GaslessPair = { trade_hash: Hex; quote_token: string };
export type GaslessQuote = GaslessPair & {
  provider: "0x";
  user_eoa: string;
  source_chain_id: number;
  sell_token: string;
  sell_amount_raw: string;
  buy_token: string;
  buy_amount_raw: string;
  min_buy_amount_raw: string;
  liquidity_available: boolean;
  expires_at: string;
  next_poll_after_seconds: number;
  zeroex_quote: { trade: GaslessPayload; approval?: GaslessPayload | null };
};
export type GaslessStatus = {
  trade_hash: Hex;
  provider: "0x";
  status: string;
  phase: "processing" | "success" | "failed";
  terminal: boolean;
  next_poll_after_seconds: number;
  zeroex_status: Record<string, unknown>;
};
export const prepareGasless = (
  config: ResolvedConfig,
  body: {
    user_eoa: string;
    source_chain_id: number;
    sell_token: string;
    sell_amount_raw: string;
    timestamp: number;
    wallet_signature: Hex;
  },
) =>
  gaslessRequest<GaslessQuote>(config, "/api/v1/gas-top-ups/prepare", {
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

export const submitGasless = (
  config: ResolvedConfig,
  body: {
    source_chain_id: number;
    quote_token: string;
    trade: SignedGaslessPayload;
    approval?: SignedGaslessPayload;
  },
) =>
  gaslessRequest<GaslessPair & { next_poll_after_seconds: number }>(
    config,
    "/api/v1/gas-top-ups/submit",
    {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );

export const getGaslessStatus = (config: ResolvedConfig, pair: GaslessPair) =>
  gaslessRequest<GaslessStatus>(
    config,
    `/api/v1/gas-top-ups/status/${encodeURIComponent(pair.trade_hash)}?source_chain_id=42161`,
    {
      headers: { "X-Gasless-Quote": pair.quote_token },
      signal: AbortSignal.timeout(10000),
    },
  );
