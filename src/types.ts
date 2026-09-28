import type { Address, Hex, EIP1193Provider } from "viem";
export type Network = "mainnet" | "testnet";
export type FundsFeature =
  "borrow" | "repay" | "deposit" | "transfer" | "withdraw";
export type Feature = FundsFeature | "tradingAccount";
export type TransferRoute =
  | "fundToTrade"
  | "accountToFund"
  | "evmToCore"
  | "coreToEvm"
  | "spotToPerps"
  | "perpsToSpot"
  | "tradeToFund"
  | "tradeToArbitrum"
  | "fundToArbitrum";
/** Semantic UI colors. Each value must be a six-digit HEX color (#RRGGBB). */
export interface WidgetColors {
  primary: string;
  surface: string;
  background: string;
  subtle: string;
  border: string;
  text: string;
  textMuted: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  debt: string;
  onPrimary: string;
  onSuccess: string;
  onWarning: string;
  badgeText: string;
  sliderTrack: string;
  overlay: string;
  shadow: string;
}

export interface WidgetConfig {
  projectId: Hex;
  network: Network;
  rpcUrl?: string;
  arbitrumRpcUrl?: string;
  /** Protocol Service used to verify successful 3 USDC gas top-ups. */
  protocolServiceUrl?: string;
  locale?: "en" | "zh";
  theme?: "light" | "dark";
  primaryColor?: string;
  /** Partial overrides of the selected theme; colors.primary takes precedence. */
  colors?: Partial<WidgetColors>;
  features?: Partial<Record<Feature, boolean>>;
  borrow?: {
    termSeconds?: number;
    maxCoreReturnFeeUsdc?: string;
    expiryWindowSeconds?: number;
  };
  /** Defaults to true; set false for deployments without LA Circle forwarding. */
  arbitrumWithdrawalEnabled?: boolean;
}
export type WalletProvider = Pick<EIP1193Provider, "request"> & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
export type Action =
  | "createAccount"
  | "bindProject"
  | FundsFeature
  | "bridgeApproval"
  | "gasFunding";
export type Stage =
  | "awaitingAction"
  | "preparing"
  | "signing"
  | "submitting"
  | "submitted"
  /** @deprecated Transactions are no longer tracked after submission. */
  | "confirming"
  /** @deprecated Transactions are no longer tracked after submission. */
  | "bridging"
  /** @deprecated Transactions are no longer tracked after submission. */
  | "settling"
  /** @deprecated Use submitted; submission does not confirm execution. */
  | "success"
  | "failed";
export interface EventContext {
  projectId: Hex;
  network: Network;
  owner?: Address;
  account?: Address;
}
export type WidgetEvent = EventContext &
  (
    | { type: "accountChanged"; status: Snapshot["status"] }
    | { type: "accountActionRequired"; reasons: string[] }
    | {
        type:
          | "operationProgress"
          | "operationSubmitted"
          /** @deprecated Use operationSubmitted; arrival is no longer tracked. */
          | "operationSuccess";
        operationId: string;
        action: Action;
        stage: Stage;
        hash?: Hex;
        destinationHash?: Hex;
      }
    | {
        type: "error";
        code: string;
        message: string;
        operationId?: string;
        hash?: Hex;
      }
  );
export interface WidgetOptions {
  config: WidgetConfig;
  wallet?: WalletProvider;
  /** Open the host connection UI (wagmi connector selector, Privy login, etc.). */
  onConnect?: () => void | Promise<void>;
  /** Host-owned registration/authorization UI; widget re-reads chain truth afterwards. */
  onAccountSetup?: (
    context: EventContext & {
      owner: Address;
      account: Address;
      reasons: string[];
    },
  ) => Promise<void>;
  /** Optional override for built-in 3 USDC gas funding. Completion is verified through Protocol Service and chain balances. */
  onGasTopUp?: (context: EventContext & { owner: Address }) => Promise<void>;
  onEvent?: (event: WidgetEvent) => void;
}
export interface Balances {
  fund: bigint;
  evm: bigint;
  spot: bigint;
  perps: bigint;
  debt: bigint;
  borrowable: bigint;
}
export interface Snapshot {
  status: "disconnected" | "loading" | "noAccount" | "ready" | "readError";
  owner?: Address;
  account?: Address;
  boundProjectId?: Hex;
  bindingEpoch?: bigint;
  reasons: string[];
  balances?: Balances;
  /** Changes after a successful account refresh, including unchanged balances. */
  balanceRevision?: number;
  minimumBorrow?: bigint;
  debtDetails?: { principal?: bigint; interest?: bigint };
  overview?: {
    collateral?: bigint;
    collateralBreakdown?: { evm?: bigint; core?: bigint };
    tradingAvailable?: bigint;
    riskBps?: bigint;
  };
  error?: string;
  busy: boolean;
  operation?: OperationRecord;
  /** Optional next step, retained only by this mounted widget. */
  continuation?: OperationRecord;
}
export interface OperationRecord extends EventContext {
  id: string;
  action: Action;
  stage: Stage;
  hash?: Hex;
  destinationHash?: Hex;
  chainId: number;
  createdAt: number;
  error?: string;
  bridge?: import("./bridge/cctp").CctpOperation;
  transferFlow?: {
    direction: "fundToTrade" | "accountToFund";
    amount: string;
    step: "approval" | "deposit" | "relay" | "topup" | "withdraw";
    relay: boolean;
    baseline: string;
    minimum: string;
    recipientBaseline: string;
    topup: string;
    completedHashes: Hex[];
    withdrawMinimum?: string;
  };
  arbitrumWithdrawal?: {
    amount: string;
    fee: string;
    step: "topup" | "bridge";
    topupHash?: Hex;
  };
  settlement?: {
    layer: "fund" | "evm" | "spot" | "perps";
    /** Owner Core sendAsset has no EVM transaction hash. */
    ownerCore?: boolean;
    baseline: string;
    minimum: string;
  };
}
export interface WidgetHandle {
  update(options: Partial<WidgetOptions>): void;
  refresh(): Promise<void>;
  destroy(): void;
}
