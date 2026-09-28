import {
  concatHex,
  isAddress,
  padHex,
  parseUnits,
  sliceHex,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import type { Network } from "../types";

export type CctpRoute = "core" | "fund" | "arbitrum";

export const CCTP = {
  evmUsdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
  transmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  messenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  forwarder: "0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757",
  depositWallet: "0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24",
  spot: 4294967295,
} as const;

export const CCTP_TESTNET = {
  evmUsdc: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  messenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  transmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
} as const;
export const cctpDeployment = (network: Network = "mainnet") =>
  network === "testnet" ? CCTP_TESTNET : CCTP;

/** Network-specific Fund deposits and Arbitrum withdrawals. */
export function cctpRoute(
  route: CctpRoute = "core",
  network: Network = "mainnet",
) {
  if (network === "testnet" && route === "core")
    throw new Error("Testnet CCTP forwarding to HyperCore is unavailable.");
  const deployment = cctpDeployment(network);
  const evmChainId = network === "testnet" ? 998 : 999;
  const arbChainId = network === "testnet" ? 421614 : 42161;
  const reverse = route === "arbitrum";
  return {
    sourceChainId: reverse ? evmChainId : arbChainId,
    destinationChainId: reverse ? arbChainId : evmChainId,
    sourceDomain: reverse ? 19 : 3,
    destinationDomain: reverse ? 3 : 19,
    sourceUsdc: reverse ? deployment.evmUsdc : deployment.usdc,
    destinationUsdc: reverse ? deployment.usdc : deployment.evmUsdc,
    messenger: deployment.messenger,
    transmitter: deployment.transmitter,
    finality: reverse ? 2000 : 1000,
  } as const;
}

export function forwardHook(
  recipient: Address,
  route: CctpRoute = "core",
): Hex {
  if (!isAddress(recipient) || /^0x0{40}$/i.test(recipient))
    throw new Error("Invalid recipient address");
  return concatHex([
    stringToHex("cctp-forward", { size: 24 }),
    toHex(0, { size: 4 }),
    toHex(route !== "core" ? 0 : 24, { size: 4 }),
    ...(route !== "core" ? [] : [recipient, toHex(CCTP.spot, { size: 4 })]),
  ]);
}

export function depositArgs(
  amount: bigint,
  fee: bigint,
  recipient: Address,
  route: CctpRoute = "core",
  network: Network = "mainnet",
) {
  if (amount <= fee || fee < BigInt(0))
    throw new Error("Amount must exceed fees");
  const routeConfig = cctpRoute(route, network);
  return [
    amount,
    routeConfig.destinationDomain,
    padHex(route !== "core" ? recipient : CCTP.forwarder, { size: 32 }),
    routeConfig.sourceUsdc,
    padHex(route !== "core" ? zeroAddress : CCTP.forwarder, { size: 32 }),
    fee,
    routeConfig.finality,
    forwardHook(recipient, route),
  ] as const;
}

export function amountUnits(value: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim())) return null;
  return parseUnits(value.trim(), 6);
}

const units = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative().safe()])
  .transform(BigInt);
const feeSchema = z.array(
  z.object({
    finalityThreshold: z.number(),
    minimumFee: z.number().nonnegative(),
    forwardFee: z.object({ high: units }),
  }),
);
export function quoteFee(
  data: unknown,
  amount: bigint,
  route: CctpRoute = "core",
): bigint {
  const quote = feeSchema
    .parse(data)
    .find((row) => row.finalityThreshold === cctpRoute(route).finality);
  if (!quote) throw new Error("Transfer quote unavailable");
  if (amount < BigInt(0)) throw new Error("Invalid amount");
  // Circle quotes basis points; use decimal integer arithmetic and round UP.
  const bps = String(quote.minimumFee);
  if (!/^\d+(\.\d{1,6})?$/.test(bps))
    throw new Error("Unsupported fee precision");
  const scale = BigInt(10000) * BigInt(1000000);
  const protocolFee = (amount * parseUnits(bps, 6) + scale - BigInt(1)) / scale;
  return protocolFee + quote.forwardFee.high;
}

/** User-visible forwarding fee ceiling: 10% buffer, rounded up to USDC subunits. */
export function cctpFeeLimit(estimate: bigint): bigint {
  if (estimate < BigInt(0)) throw new Error("Invalid fee");
  return (estimate * BigInt(110) + BigInt(99)) / BigInt(100);
}

const addressSchema = z
  .string()
  .refine((v) => isAddress(v) && v.toLowerCase() !== zeroAddress)
  .transform((v) => v as Address);
const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as Hex);
export const operationSchema = z
  .object({
    route: z.enum(["core", "fund", "arbitrum"]).optional(),
    owner: addressSchema,
    sourceAccount: addressSchema.optional(),
    network: z.enum(["mainnet", "testnet"]).optional(),
    recipient: addressSchema,
    hash: hashSchema,
    amount: z.string().regex(/^\d+$/),
    maxFee: z.string().regex(/^\d+$/),
    baseline: z.string().regex(/^\d+$/),
    createdAt: z.number().int().positive(),
    forwardHash: hashSchema.optional(),
    nonce: hashSchema.optional(),
    completed: z.boolean().optional(),
    receivedAmount: z.string().regex(/^\d+$/).optional(),
  })
  .refine(
    (op) =>
      !op.sourceAccount ||
      (op.route === "arbitrum" &&
        op.sourceAccount.toLowerCase() !== op.owner.toLowerCase()),
    "Invalid LA source",
  )
  .refine(
    (op) => BigInt(op.amount) > BigInt(op.maxFee),
    "Amount must exceed fees",
  )
  .refine(
    (op) =>
      (op.route !== "fund" && op.route !== "arbitrum") ||
      op.owner.toLowerCase() === op.recipient.toLowerCase(),
    "Fund recipient must be owner",
  );
export type CctpOperation = z.infer<typeof operationSchema>;
export function operationKey(
  owner: string,
  recipient: string,
  route: CctpRoute = "core",
  network: Network = "mainnet",
) {
  const config = cctpRoute(route, network);
  if (route === "arbitrum")
    return `cctp:arbitrum:v1:${config.sourceChainId}:${config.destinationChainId}:${owner.toLowerCase()}:${recipient.toLowerCase()}`;
  return `cctp:${route === "fund" ? "fund:v1:" : ""}${config.sourceChainId}:${config.destinationChainId}:${owner.toLowerCase()}:${recipient.toLowerCase()}`;
}

export const messagesSchema = z.object({
  messages: z.array(
    z.object({
      // Circle can return null while the attestation is still pending.
      message: z.string().nullable(),
      status: z.string(),
      forwardState: z.string().nullish(),
      forwardTxHash: z.string().nullish(),
      eventNonce: z.string().optional(),
    }),
  ),
});

export function validateMessage(message: string, op: CctpOperation) {
  const fund = op.route === "fund" || op.route === "arbitrum";
  const routeConfig = cctpRoute(op.route, op.network);
  if (fund && op.owner.toLowerCase() !== op.recipient.toLowerCase())
    throw new Error("Fund recipient must be owner");
  if (!(fund ? /^0x[0-9a-fA-F]{816}$/ : /^0x[0-9a-fA-F]{864}$/).test(message))
    throw new Error("Unexpected CCTP message length");
  const raw = message as Hex;
  const n = (start: number, end: number) => BigInt(sliceHex(raw, start, end));
  const address = (start: number) =>
    sliceHex(raw, start, start + 32).toLowerCase();
  const expected = (a: Address) => padHex(a, { size: 32 }).toLowerCase();
  // Circle MessageV2 header (148 bytes) followed by BurnMessageV2 (228 bytes + hook).
  if (
    n(0, 4) !== BigInt(1) ||
    n(4, 8) !== BigInt(routeConfig.sourceDomain) ||
    n(8, 12) !== BigInt(routeConfig.destinationDomain) ||
    address(44) !== expected(routeConfig.messenger) ||
    address(76) !== expected(routeConfig.messenger) ||
    address(108) !== expected(fund ? zeroAddress : CCTP.forwarder) ||
    n(140, 144) !== BigInt(routeConfig.finality) ||
    !(
      routeConfig.finality === 2000
        ? [BigInt(2000)]
        : [BigInt(1000), BigInt(2000)]
    ).includes(n(144, 148)) ||
    n(148, 152) !== BigInt(1) ||
    address(152) !== expected(routeConfig.sourceUsdc) ||
    address(184) !== expected(fund ? op.owner : CCTP.forwarder) ||
    n(216, 248) !== BigInt(op.amount) ||
    address(248) !== expected(op.sourceAccount ?? op.owner) ||
    n(280, 312) !== BigInt(op.maxFee) ||
    n(312, 344) > BigInt(op.maxFee) ||
    n(312, 344) >= BigInt(op.amount) ||
    sliceHex(raw, 376).toLowerCase() !==
      forwardHook(op.recipient, op.route).toLowerCase()
  ) {
    throw new Error("CCTP message does not match this deposit");
  }
  return { net: BigInt(op.amount) - n(312, 344), nonce: sliceHex(raw, 12, 44) };
}
