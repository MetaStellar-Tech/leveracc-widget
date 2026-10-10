import type { Address } from "viem";
import { invariant } from "../core/errors";

export interface GasTopUpRecord {
  user_eoa?: string;
  cost_breakdown?: {
    activation_required: boolean;
    activation_fee_reserved_usdc_amount_raw: string;
    activation_transfer_reserved_usdc_amount_raw: string;
  };
  id?: string;
  created_at?: string;
  next_poll_after_seconds?: number;
  requested_usdc_amount_raw?: string;
  phase?: string;
  terminal?: boolean;
  source_chain_id?: number;
  source_tx_hash?: string;
  evm_tx_hash?: string | null;
  system_core_account_address?: string;
  status_message?: string;
}

export async function gasTopUpRequest(
  baseUrl: string,
  path: string,
): Promise<unknown> {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/api/v1/gas-top-ups${path}`,
    { cache: "no-store", signal: AbortSignal.timeout(15000) },
  );
  invariant(
    response.ok,
    "TOP_UP_CHECK_FAILED",
    "Unable to check gas top-up history. Please try again.",
  );
  let payload: unknown = await response.json();
  if (payload && typeof payload === "object" && "data" in payload)
    payload = payload.data;
  return payload;
}

export async function listGasTopUps(
  baseUrl: string,
  owner: Address,
): Promise<GasTopUpRecord[]> {
  let payload = await gasTopUpRequest(
    baseUrl,
    `?${new URLSearchParams({ user_eoa: owner })}`,
  );
  if (payload && typeof payload === "object" && "items" in payload)
    payload = payload.items;
  invariant(
    Array.isArray(payload),
    "TOP_UP_CHECK_FAILED",
    "Invalid gas top-up history response. Please try again.",
  );
  return payload.filter(
    (record): record is GasTopUpRecord =>
      !!record && typeof record === "object",
  );
}

export const isCreationTopUp = (record: GasTopUpRecord) =>
  record.requested_usdc_amount_raw === "3000000" &&
  record.phase === "success" &&
  record.terminal === true;

/** Read server history, never browser-local evidence of a payment. */
export async function hasCreationTopUp(
  baseUrl: string,
  owner: Address,
): Promise<boolean> {
  return (await listGasTopUps(baseUrl, owner)).some(isCreationTopUp);
}
