import {
  WithdrawIntentTypes as withdrawIntentTypes,
  WithdrawEvmToCoreIntentTypes as withdrawEvmToCoreIntentTypes,
  type WithdrawIntent,
  type WithdrawEvmToCoreIntent,
} from "../abi/generated/WithdrawalTypes";
export { withdrawIntentTypes, withdrawEvmToCoreIntentTypes };
export type { WithdrawIntent, WithdrawEvmToCoreIntent };

import {
  DEFAULT_PROJECT_ID,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  createIntentExpiry,
} from "./account-factory-intent";

export interface WithdrawTypedData {
  domain: {
    name: typeof EIP712_DOMAIN_NAME;
    version: typeof EIP712_DOMAIN_VERSION;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof withdrawIntentTypes;
  primaryType: "WithdrawIntent";
  message: WithdrawIntent;
}

export interface WithdrawEvmToCoreTypedData {
  domain: WithdrawTypedData["domain"];
  types: typeof withdrawEvmToCoreIntentTypes;
  primaryType: "WithdrawEvmToCoreIntent";
  message: WithdrawEvmToCoreIntent;
}

type IntentBuilderInput<
  T extends { nonce: bigint; expiry: bigint; projectId: `0x${string}` },
> = Omit<T, "nonce" | "expiry" | "projectId"> & {
  nonce: bigint | number | string;
  expiryWindowSeconds?: number;
  expiry?: T["expiry"];
  projectId?: T["projectId"];
};

export function buildWithdrawEvmToCoreIntent(
  input: IntentBuilderInput<WithdrawEvmToCoreIntent>,
): WithdrawEvmToCoreIntent {
  return {
    projectId: input.projectId ?? DEFAULT_PROJECT_ID,
    account: input.account,
    user: input.user,
    requestedAmount: input.requestedAmount,
    minDebitedAmount: input.minDebitedAmount,
    coreRecipient: input.coreRecipient,
    nonce: BigInt(input.nonce),
    expiry:
      input.expiry ??
      createIntentExpiry(Date.now(), input.expiryWindowSeconds ?? 15 * 60),
  };
}

export function buildWithdrawEvmToCoreTypedData(
  intent: WithdrawEvmToCoreIntent,
  chainId: number,
  verifyingContract: `0x${string}`,
): WithdrawEvmToCoreTypedData {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    },
    types: withdrawEvmToCoreIntentTypes,
    primaryType: "WithdrawEvmToCoreIntent",
    message: intent,
  };
}

export function buildWithdrawIntent(
  input: IntentBuilderInput<WithdrawIntent>,
): WithdrawIntent {
  return {
    projectId: input.projectId ?? DEFAULT_PROJECT_ID,
    account: input.account,
    user: input.user,
    requestedAmount: input.requestedAmount,
    minPayoutAmount: input.minPayoutAmount,
    withdrawRecipient: input.withdrawRecipient,
    nonce: BigInt(input.nonce),
    expiry:
      input.expiry ??
      createIntentExpiry(Date.now(), input.expiryWindowSeconds ?? 15 * 60),
  };
}

export function buildWithdrawTypedData(
  intent: WithdrawIntent,
  chainId: number,
  verifyingContract: `0x${string}`,
): WithdrawTypedData {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    },
    types: withdrawIntentTypes,
    primaryType: "WithdrawIntent",
    message: intent,
  };
}
