import {
  DEFAULT_PROJECT_ID,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  createIntentExpiry,
} from "./account-factory-intent";

export interface RepayIntent {
  projectId: `0x${string}`;
  account: `0x${string}`;
  user: `0x${string}`;
  requestedRepayAmount: bigint;
  nonce: bigint;
  expiry: bigint;
}

export const repayIntentTypes = {
  RepayIntent: [
    { name: "projectId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "user", type: "address" },
    { name: "requestedRepayAmount", type: "uint128" },
    { name: "nonce", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export interface RepayTypedData {
  domain: {
    name: typeof EIP712_DOMAIN_NAME;
    version: typeof EIP712_DOMAIN_VERSION;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof repayIntentTypes;
  primaryType: "RepayIntent";
  message: RepayIntent;
}

export function buildRepayIntent(input: {
  account: `0x${string}`;
  user: `0x${string}`;
  nonce: bigint | number | string;
  requestedRepayAmount: bigint;
  expiryWindowSeconds?: number;
  expiry?: bigint;
  projectId?: `0x${string}`;
}): RepayIntent {
  return {
    projectId: input.projectId ?? DEFAULT_PROJECT_ID,
    account: input.account,
    user: input.user,
    requestedRepayAmount: input.requestedRepayAmount,
    nonce: BigInt(input.nonce),
    expiry:
      input.expiry ??
      createIntentExpiry(Date.now(), input.expiryWindowSeconds ?? 15 * 60),
  };
}

export function buildRepayTypedData(
  intent: RepayIntent,
  chainId: number,
  verifyingContract: `0x${string}`,
): RepayTypedData {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    },
    types: repayIntentTypes,
    primaryType: "RepayIntent",
    message: intent,
  };
}
