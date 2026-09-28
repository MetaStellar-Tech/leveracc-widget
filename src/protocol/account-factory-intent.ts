import { keccak256, toBytes, toHex, zeroHash } from "viem";

export const EIP712_DOMAIN_NAME = "LeverAccProtocol";
export const EIP712_DOMAIN_VERSION = "1";
export const CREATE_ACCOUNT_INTENT_EXPIRY_WINDOW_SECONDS = 10 * 60;

export interface CreateAccountIntent {
  projectId: `0x${string}`;
  user: `0x${string}`;
  salt: `0x${string}`;
  nonce: `0x${string}`;
  expiry: bigint;
}

export const createAccountIntentTypes = {
  CreateAccountIntent: [
    { name: "projectId", type: "bytes32" },
    { name: "user", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export interface CreateAccountTypedData {
  domain: {
    name: typeof EIP712_DOMAIN_NAME;
    version: typeof EIP712_DOMAIN_VERSION;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof createAccountIntentTypes;
  primaryType: "CreateAccountIntent";
  message: CreateAccountIntent;
}

export const DEFAULT_PROJECT_ID = zeroHash;
export const DEFAULT_ACCOUNT_SALT = keccak256(toBytes("primary"));

export function createIntentNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random generator is not available");
  }
  cryptoApi.getRandomValues(bytes);
  return toHex(bytes);
}

export function createIntentExpiry(
  nowMs = Date.now(),
  windowSeconds = CREATE_ACCOUNT_INTENT_EXPIRY_WINDOW_SECONDS,
): bigint {
  return BigInt(Math.floor(nowMs / 1000) + windowSeconds);
}

export function buildCreateAccountIntent(
  walletAddress: `0x${string}`,
  options: {
    projectId?: `0x${string}`;
    salt?: `0x${string}`;
    nonce: `0x${string}`;
    expiry?: bigint;
  },
): CreateAccountIntent {
  return {
    projectId: options.projectId ?? DEFAULT_PROJECT_ID,
    user: walletAddress,
    salt: options.salt ?? DEFAULT_ACCOUNT_SALT,
    nonce: options.nonce,
    expiry: options.expiry ?? createIntentExpiry(),
  };
}

export function buildCreateAccountTypedData(
  intent: CreateAccountIntent,
  chainId: number,
  verifyingContract: `0x${string}`,
): CreateAccountTypedData {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    },
    types: createAccountIntentTypes,
    primaryType: "CreateAccountIntent",
    message: intent,
  };
}
