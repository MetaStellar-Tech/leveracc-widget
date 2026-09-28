import {
  DEFAULT_PROJECT_ID,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  createIntentExpiry,
} from "./account-factory-intent";

export interface BorrowIntent {
  projectId: `0x${string}`;
  account: `0x${string}`;
  user: `0x${string}`;
  termSeconds: number;
  lotFactorPpm: number;
  minBorrowAmount: bigint;
  maxBorrowAmount: bigint;
  maxCoreReturnFee: bigint;
  expectedBorrowRateVersion: bigint;
  nonce: bigint;
  expiry: bigint;
}

export const borrowIntentTypes = {
  BorrowIntent: [
    { name: "projectId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "user", type: "address" },
    { name: "termSeconds", type: "uint32" },
    { name: "lotFactorPpm", type: "uint32" },
    { name: "minBorrowAmount", type: "uint128" },
    { name: "maxBorrowAmount", type: "uint128" },
    { name: "maxCoreReturnFee", type: "uint128" },
    { name: "expectedBorrowRateVersion", type: "uint64" },
    { name: "nonce", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export interface BorrowTypedData {
  domain: {
    name: typeof EIP712_DOMAIN_NAME;
    version: typeof EIP712_DOMAIN_VERSION;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof borrowIntentTypes;
  primaryType: "BorrowIntent";
  message: BorrowIntent;
}

export function buildBorrowIntent(input: {
  account: `0x${string}`;
  user: `0x${string}`;
  nonce: bigint | number | string;
  /** Exact borrow: both bounds are set equal to this amount. */
  borrowAmount: bigint;
  minBorrowAmount?: bigint;
  maxBorrowAmount?: bigint;
  termSeconds: number;
  lotFactorPpm: number;
  maxCoreReturnFee: bigint;
  expectedBorrowRateVersion: bigint | number | string;
  expiryWindowSeconds?: number;
  expiry?: bigint;
  projectId?: `0x${string}`;
}): BorrowIntent {
  const minBorrowAmount = input.minBorrowAmount ?? input.borrowAmount;
  const maxBorrowAmount = input.maxBorrowAmount ?? input.borrowAmount;
  return {
    projectId: input.projectId ?? DEFAULT_PROJECT_ID,
    account: input.account,
    user: input.user,
    termSeconds: input.termSeconds,
    lotFactorPpm: input.lotFactorPpm,
    minBorrowAmount,
    maxBorrowAmount,
    maxCoreReturnFee: input.maxCoreReturnFee,
    expectedBorrowRateVersion: BigInt(input.expectedBorrowRateVersion),
    nonce: BigInt(input.nonce),
    expiry:
      input.expiry ??
      createIntentExpiry(Date.now(), input.expiryWindowSeconds ?? 15 * 60),
  };
}

export function buildBorrowTypedData(
  intent: BorrowIntent,
  chainId: number,
  verifyingContract: `0x${string}`,
): BorrowTypedData {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    },
    types: borrowIntentTypes,
    primaryType: "BorrowIntent",
    message: intent,
  };
}
