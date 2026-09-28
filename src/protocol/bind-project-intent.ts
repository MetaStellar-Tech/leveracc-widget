import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  createIntentExpiry,
  createIntentNonce,
} from "./account-factory-intent";

export const BIND_PROJECT_INTENT_EXPIRY_WINDOW_SECONDS = 15 * 60;

export interface BindProjectIntent {
  requestId: `0x${string}`;
  fromProjectId: `0x${string}`;
  toProjectId: `0x${string}`;
  account: `0x${string}`;
  user: `0x${string}`;
  nonce: bigint;
  currentProjectBindingEpoch: bigint;
  nextProjectBindingEpoch: bigint;
  expiry: bigint;
}

export const bindProjectIntentTypes = {
  BindProjectIntent: [
    { name: "requestId", type: "bytes32" },
    { name: "fromProjectId", type: "bytes32" },
    { name: "toProjectId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "user", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "currentProjectBindingEpoch", type: "uint64" },
    { name: "nextProjectBindingEpoch", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export interface BindProjectTypedData {
  domain: {
    name: typeof EIP712_DOMAIN_NAME;
    version: typeof EIP712_DOMAIN_VERSION;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof bindProjectIntentTypes;
  primaryType: "BindProjectIntent";
  message: BindProjectIntent;
}

export function buildBindProjectIntent(input: {
  fromProjectId: `0x${string}`;
  toProjectId: `0x${string}`;
  account: `0x${string}`;
  user: `0x${string}`;
  nonce: bigint | number | string;
  currentProjectBindingEpoch: bigint | number | string;
  nextProjectBindingEpoch: bigint | number | string;
  requestId?: `0x${string}`;
  expiry?: bigint;
  expiryWindowSeconds?: number;
}): BindProjectIntent {
  return {
    requestId: input.requestId ?? createIntentNonce(),
    fromProjectId: input.fromProjectId,
    toProjectId: input.toProjectId,
    account: input.account,
    user: input.user,
    nonce: BigInt(input.nonce),
    currentProjectBindingEpoch: BigInt(input.currentProjectBindingEpoch),
    nextProjectBindingEpoch: BigInt(input.nextProjectBindingEpoch),
    expiry:
      input.expiry ??
      createIntentExpiry(
        Date.now(),
        input.expiryWindowSeconds ?? BIND_PROJECT_INTENT_EXPIRY_WINDOW_SECONDS,
      ),
  };
}

export function buildBindProjectTypedData(
  intent: BindProjectIntent,
  chainId: number,
  verifyingContract: `0x${string}`,
): BindProjectTypedData {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    },
    types: bindProjectIntentTypes,
    primaryType: "BindProjectIntent",
    message: intent,
  };
}
