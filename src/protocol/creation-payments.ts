import { z } from "zod";
import { isAddress, zeroAddress, type Address } from "viem";
import type { ResolvedConfig } from "../core/config";
import type { WalletProvider } from "../types";
import { invariant } from "../core/errors";
import { signer } from "../core/wallet";
import {
  creationAmount,
  flowEndpoint,
  type CreationFlow,
} from "./creation-policy";
import { isCreationTopUp, type GasTopUpRecord } from "./gas-top-ups";

const address = z
  .string()
  .refine((v) => isAddress(v) && v.toLowerCase() !== zeroAddress);
const rawAmount = z.string().regex(/^\d+$/);
const orderSchema = z.object({
  id: z.string().uuid(),
  user_eoa: address,
  flow: z.enum(["gas_only", "activation_only"]),
  source: z.enum(["core", "arbitrum"]),
  receiver_address: address,
  amount_raw: rawAmount,
  nonce: z.string().uuid(),
  expires_at: z.string().datetime({ offset: true }),
  status: z.enum(["awaiting_payment", "matched", "expired", "manual_review"]),
  matched_activation_id: z.string().uuid().optional(),
  matched_top_up_id: z.string().uuid().optional(),
  last_error: z.string().nullish(),
});
export type PaymentOrder = z.infer<typeof orderSchema>;
const challengeSchema = orderSchema
  .omit({ id: true, status: true })
  .extend({ signing_message: z.string() });
export const activationSchema = z.object({
  id: z.string().uuid(),
  user_eoa: address,
  status: z.enum([
    "waiting_account",
    "submitting",
    "activated",
    "manual_review",
    "refunded",
  ]),
  source_chain_id: z.number().nullish(),
  source_tx_hash: z.string().nullish(),
  last_error: z.string().nullish(),
});
export type ActivationRecord = z.infer<typeof activationSchema>;
export const activationReady = (record: ActivationRecord) =>
  ["waiting_account", "submitting", "activated"].includes(record.status);

export async function paymentRequest(
  config: ResolvedConfig,
  flow: CreationFlow,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(
    `${config.protocolServiceUrl}/api/v1/${flowEndpoint(flow)}${path}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  invariant(
    response.ok,
    "TOP_UP_CHECK_FAILED",
    "Unable to check or prepare account funding. Please try again.",
  );
  const payload = await response.json();
  return payload && typeof payload === "object" && "data" in payload
    ? payload.data
    : payload;
}
export async function paymentList(
  config: ResolvedConfig,
  flow: CreationFlow,
  owner: Address,
  path = "",
): Promise<unknown[]> {
  const result: unknown[] = [];
  for (let offset = 0; ; offset += 50) {
    const payload = await paymentRequest(
      config,
      flow,
      `${path}?${new URLSearchParams({ user_eoa: owner, limit: "50", offset: String(offset) })}`,
    );
    const items = z
      .array(z.unknown())
      .parse(
        payload && typeof payload === "object" && "items" in payload
          ? payload.items
          : payload,
      );
    result.push(...items);
    if (items.length < 50) return result;
  }
}
export async function listActivations(config: ResolvedConfig, owner: Address) {
  const records = z
    .array(activationSchema)
    .parse(await paymentList(config, "activation_only", owner));
  invariant(
    records.every((r) => r.user_eoa.toLowerCase() === owner.toLowerCase()),
    "FUNDING_MISMATCH",
    "Activation owner mismatch.",
  );
  return records;
}
export async function activationEligibility(
  config: ResolvedConfig,
  owner: Address,
) {
  const records = await listActivations(config, owner);
  if (records.some(activationReady)) return true;
  const state = z
    .object({ enabled: z.boolean(), status: z.string() })
    .parse(
      await paymentRequest(
        config,
        "activation_only",
        `/config?user_eoa=${owner}`,
      ),
    );
  return state.enabled && state.status === "already_activated";
}
export async function listConversions(config: ResolvedConfig, owner: Address) {
  const records = z
    .array(
      z
        .object({
          id: z.string(),
          user_eoa: address,
          requested_usdc_amount_raw: rawAmount,
          phase: z.string(),
          terminal: z.boolean(),
        })
        .passthrough(),
    )
    .parse(await paymentList(config, "gas_only", owner));
  invariant(
    records.every((r) => r.user_eoa.toLowerCase() === owner.toLowerCase()),
    "FUNDING_MISMATCH",
    "Gas conversion owner mismatch.",
  );
  return records as GasTopUpRecord[];
}
export async function combinedActivationReady(
  config: ResolvedConfig,
  owner: Address,
  records: GasTopUpRecord[],
) {
  const paid = records.filter(isCreationTopUp);
  if (
    paid.some(
      (record) =>
        record.cost_breakdown?.activation_required === true &&
        record.cost_breakdown.activation_fee_reserved_usdc_amount_raw ===
          "1000000" &&
        record.cost_breakdown.activation_transfer_reserved_usdc_amount_raw ===
          "100000",
    )
  )
    return true;
  // Zero allocation alone also occurs when the service has activation disabled.
  // Require independent activation evidence before accepting such a payment.
  return paid.some(
    (record) => record.cost_breakdown?.activation_required === false,
  )
    ? activationEligibility(config, owner)
    : false;
}
export async function getOrder(
  config: ResolvedConfig,
  flow: CreationFlow,
  id: string,
) {
  const order = orderSchema.parse(
    await paymentRequest(config, flow, `/orders/${encodeURIComponent(id)}`),
  );
  invariant(
    order.id === id,
    "FUNDING_MISMATCH",
    "Payment order identity mismatch.",
  );
  return order;
}
export function validateOrder(
  order: PaymentOrder,
  owner: Address,
  flow: CreationFlow,
  source: string,
  receiver: string,
) {
  invariant(
    order.user_eoa.toLowerCase() === owner.toLowerCase() &&
      order.flow === flow &&
      order.source === source &&
      order.receiver_address.toLowerCase() === receiver.toLowerCase() &&
      order.amount_raw === creationAmount(flow),
    "FUNDING_MISMATCH",
    "Payment order does not match this wallet, flow, receiver or amount.",
  );
}
export async function prepareOrder(
  config: ResolvedConfig,
  provider: WalletProvider,
  owner: Address,
  flow: CreationFlow,
  source: "core" | "arbitrum",
  receiver: Address,
  current: () => boolean,
) {
  const orders = z
    .array(orderSchema)
    .parse(await paymentList(config, flow, owner, "/orders"));
  const active = orders.filter(
    (o) =>
      o.status === "awaiting_payment" && Date.parse(o.expires_at) > Date.now(),
  );
  invariant(
    active.length <= 1,
    "FUNDING_PENDING",
    "Multiple payment orders require review.",
  );
  if (active[0]) {
    validateOrder(active[0], owner, flow, source, receiver);
    invariant(
      Date.parse(active[0].expires_at) > Date.now() + 30000,
      "ORDER_EXPIRED",
      "Payment order is expiring. Wait for expiry before retrying.",
    );
    return active[0];
  }
  const input = { user_eoa: owner, source, amount_raw: creationAmount(flow) };
  const challenge = challengeSchema.parse(
    await paymentRequest(config, flow, "/orders/challenge", input),
  );
  validateOrder(
    { ...challenge, id: "", status: "awaiting_payment" },
    owner,
    flow,
    source,
    receiver,
  );
  const expires = Date.parse(challenge.expires_at);
  const message = `LeverAcc Gas Station Payment Intent\nVersion: 1\nFlow: ${flow}\nSource: ${source}\nPayer: ${challenge.user_eoa}\nReceiver: ${challenge.receiver_address}\nAmountRaw: ${challenge.amount_raw}\nNonce: ${challenge.nonce}\nExpiresAt: ${expires / 1000}`;
  invariant(
    challenge.signing_message === message &&
      Number.isInteger(expires / 1000) &&
      expires > Date.now() + 30000 &&
      expires <= Date.now() + 600000,
    "FUNDING_MISMATCH",
    "Invalid payment signing challenge.",
  );
  const wallet = await signer(
    provider,
    owner,
    source === "arbitrum" ? config.arbitrumChain : config.chain,
    current,
  );
  const signature = await wallet.signMessage({ message });
  await signer(
    provider,
    owner,
    source === "arbitrum" ? config.arbitrumChain : config.chain,
    current,
  );
  invariant(current(), "CONTEXT_CHANGED", "Wallet context changed.");
  const order = orderSchema.parse(
    await paymentRequest(config, flow, "/orders", {
      ...input,
      nonce: challenge.nonce,
      expires_at: challenge.expires_at,
      signature,
    }),
  );
  validateOrder(order, owner, flow, source, receiver);
  invariant(
    order.nonce === challenge.nonce &&
      order.expires_at === challenge.expires_at &&
      order.status === "awaiting_payment",
    "FUNDING_MISMATCH",
    "Payment order does not match the signed challenge.",
  );
  return order;
}
