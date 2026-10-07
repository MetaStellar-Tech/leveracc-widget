import {
  hyperliquid,
  hyperliquidEvmTestnet,
  arbitrum,
  arbitrumSepolia,
} from "viem/chains";
import type { Address } from "viem";
import type { WidgetConfig } from "../types";
import { invariant } from "./errors";
import { resolveColors } from "./colors";
import { parseAmount } from "./amount";
const presets = {
  mainnet: {
    chain: hyperliquid,
    coreDepositWallet: "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24",
    factory: "0x7211c8159449b99f0b7cdb6b7a9ea01b2e5c1ce7",
    manager: "0x03524982bba6763d045d1a44f3c090ffcf39774b",
  },
  testnet: {
    chain: hyperliquidEvmTestnet,
    coreDepositWallet: "0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206",
    factory: "0xe672fc21d0e429076b4386d20b5951eba214aedb",
    manager: "0x99d8f178af00b229cbc00676f42f0a492bdef52c",
  },
} as const;
function url(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Service URLs must be absolute HTTP(S) URLs.");
  }
  invariant(
    ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password,
    "INVALID_CONFIG",
    "Invalid service URL.",
  );
  return value.replace(/\/$/, "");
}
export function resolveConfig(input: WidgetConfig) {
  invariant(
    input && /^0x[\da-f]{64}$/i.test(input.projectId),
    "INVALID_CONFIG",
    "projectId must be bytes32.",
  );
  invariant(
    input.network === "mainnet" || input.network === "testnet",
    "INVALID_CONFIG",
    "Select mainnet or testnet.",
  );
  invariant(
    !input.primaryColor || /^#[\da-f]{6}$/i.test(input.primaryColor),
    "INVALID_CONFIG",
    "primaryColor must be a six-digit hex color.",
  );
  invariant(
    !input.locale || ["en", "zh"].includes(input.locale),
    "INVALID_CONFIG",
    "Unsupported locale.",
  );
  invariant(
    !input.theme || ["light", "dark"].includes(input.theme),
    "INVALID_CONFIG",
    "Unsupported theme.",
  );
  invariant(
    input.skipCreationTopUpCheck === undefined ||
      typeof input.skipCreationTopUpCheck === "boolean",
    "INVALID_CONFIG",
    "skipCreationTopUpCheck must be a boolean.",
  );
  const preset = presets[input.network];
  const borrow = {
    termSeconds: 604800,
    maxCoreReturnFeeUsdc: "1",
    expiryWindowSeconds: 900,
    ...input.borrow,
  };
  invariant(
    Number.isInteger(borrow.termSeconds) &&
      borrow.termSeconds > 0 &&
      borrow.termSeconds < 2 ** 32 &&
      Number.isInteger(borrow.expiryWindowSeconds) &&
      borrow.expiryWindowSeconds > 0 &&
      borrow.expiryWindowSeconds <= 3600,
    "INVALID_CONFIG",
    "Invalid borrow term or signature expiry.",
  );
  parseAmount(borrow.maxCoreReturnFeeUsdc);
  const features = {
    tradingAccount: true,
    borrow: true,
    repay: true,
    deposit: true,
    transfer: true,
    withdraw: true,
    ...input.features,
  };
  invariant(
    Object.values(features).every((value) => typeof value === "boolean"),
    "INVALID_CONFIG",
    "Feature flags must be booleans.",
  );
  return {
    ...input,
    projectId: input.projectId.toLowerCase() as typeof input.projectId,
    chain: preset.chain,
    arbitrumChain: input.network === "testnet" ? arbitrumSepolia : arbitrum,
    factory: preset.factory as Address,
    manager: preset.manager as Address,
    rpcUrl: url(input.rpcUrl ?? preset.chain.rpcUrls.default.http[0]),
    arbitrumRpcUrl: url(
      input.arbitrumRpcUrl ??
        (input.network === "testnet" ? arbitrumSepolia : arbitrum).rpcUrls
          .default.http[0],
    ),
    protocolServiceUrl: url(
      input.protocolServiceUrl ??
        (input.network === "mainnet"
          ? "https://protocol-service.leveracc.xyz"
          : "https://protocol-service-testnet.leveracc.xyz"),
    ),
    skipCreationTopUpCheck: input.skipCreationTopUpCheck ?? false,
    locale: input.locale ?? "en",
    theme: input.theme ?? "dark",
    primaryColor: input.primaryColor ?? "#0099ff",
    colors: resolveColors(input),
    coreDepositWallet: preset.coreDepositWallet as Address,
    features,
    borrow,
    arbitrumWithdrawalEnabled: input.arbitrumWithdrawalEnabled !== false,
  };
}
export type ResolvedConfig = ReturnType<typeof resolveConfig>;
