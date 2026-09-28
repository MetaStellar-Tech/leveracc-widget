import { isAddress, type Address, type WalletClient } from "viem";
import type { WalletProvider } from "../types";
import { invariant } from "../core/errors";

type Request = { method: string; params?: readonly unknown[] | object };
type Listener = (...args: unknown[]) => void;
export interface WalletSource {
  address: string;
  getProvider(): Promise<unknown>;
  switchChain?: (chainId: number) => Promise<unknown>;
}
export interface WalletAdapter extends WalletProvider {
  /** Call when this host wallet selection is replaced or disconnected. */
  destroy(): void;
}
function providerOf(value: unknown): WalletProvider {
  invariant(
    value &&
      typeof value === "object" &&
      "request" in value &&
      typeof value.request === "function",
    "INVALID_WALLET",
    "The wallet must expose an EIP-1193 provider.",
  );
  return value as WalletProvider;
}
/** Pins identity to a wallet explicitly selected by the host, never to wallets[0]. */
export async function createWalletAdapter(
  source: WalletSource,
): Promise<WalletAdapter> {
  invariant(
    isAddress(source.address),
    "INVALID_WALLET",
    "Select a valid EVM wallet address.",
  );
  let provider = providerOf(await source.getProvider());
  let destroyed = false;
  const listeners = new Map<string, Set<Listener>>();
  const forwarders = new Map<string, Listener>();
  const emit = (event: string, ...args: unknown[]) =>
    listeners.get(event)?.forEach((listener) => listener(...args));
  function subscribe(event: string) {
    if (forwarders.has(event)) return;
    const forward: Listener = (...args) => emit(event, ...args);
    forwarders.set(event, forward);
    provider.on?.(event, forward);
  }
  function replace(next: WalletProvider) {
    if (next === provider) return;
    for (const [event, listener] of forwarders)
      provider.removeListener?.(event, listener);
    provider = next;
    for (const [event, listener] of forwarders) provider.on?.(event, listener);
  }
  const accounts = async (method = "eth_accounts") => {
    const result = await (
      provider.request as (request: Request) => Promise<unknown>
    )({ method });
    invariant(
      Array.isArray(result),
      "INVALID_WALLET",
      "Wallet returned invalid accounts.",
    );
    if (!result.length) return [];
    invariant(
      result.some(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase() === source.address.toLowerCase(),
      ),
      "OWNER_WALLET_MISMATCH",
      "Reconnect the wallet selected in your application.",
    );
    return [source.address as Address];
  };
  const request = async (args: Request) => {
    invariant(
      !destroyed,
      "WALLET_DISCONNECTED",
      "This wallet selection is no longer connected.",
    );
    if (args.method === "eth_accounts" || args.method === "eth_requestAccounts")
      return accounts(args.method);
    if (args.method === "wallet_switchEthereumChain" && source.switchChain) {
      const chainId = Number(
        (args.params as { chainId: string }[])[0]?.chainId,
      );
      invariant(
        Number.isSafeInteger(chainId) && chainId > 0,
        "INVALID_CHAIN",
        "Invalid target chain.",
      );
      await source.switchChain(chainId);
      invariant(
        !destroyed,
        "WALLET_DISCONNECTED",
        "Wallet disconnected while switching networks.",
      );
      replace(providerOf(await source.getProvider()));
      await accounts();
      const actual = await provider.request({ method: "eth_chainId" });
      invariant(
        Number(actual) === chainId,
        "OWNER_NETWORK_MISMATCH",
        "Wallet did not switch to the requested network.",
      );
      emit("chainChanged", actual);
      return null;
    }
    if (/^(eth_send|eth_sign|personal_sign|wallet_send)/.test(args.method)) {
      invariant(
        (await accounts()).length > 0,
        "WALLET_DISCONNECTED",
        "Reconnect your wallet before signing.",
      );
      invariant(
        !destroyed,
        "WALLET_DISCONNECTED",
        "Wallet disconnected before signing.",
      );
    }
    return (provider.request as (request: Request) => Promise<unknown>)(args);
  };
  return {
    request: request as WalletProvider["request"],
    on(event, listener) {
      invariant(
        !destroyed,
        "WALLET_DISCONNECTED",
        "Wallet adapter has been destroyed.",
      );
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      subscribe(event);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
      if (!listeners.get(event)?.size) {
        const forward = forwarders.get(event);
        if (forward) provider.removeListener?.(event, forward);
        forwarders.delete(event);
        listeners.delete(event);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      emit("disconnect", {
        code: 4900,
        message: "Host wallet selection disconnected.",
      });
      for (const [event, listener] of forwarders)
        provider.removeListener?.(event, listener);
      forwarders.clear();
      listeners.clear();
    },
  };
}

export interface WagmiConnectorSource {
  getProvider(): Promise<unknown>;
  switchChain?: (parameters: { chainId: number }) => Promise<unknown>;
}
/** Compatible with wagmi v2/v3 connectors, including WalletConnect and EIP-6963. */
export function walletFromWagmi(
  connector: WagmiConnectorSource,
  address: Address,
) {
  return createWalletAdapter({
    address,
    getProvider: () => connector.getProvider(),
    switchChain: connector.switchChain
      ? (chainId) => connector.switchChain!({ chainId })
      : undefined,
  });
}
export interface PrivyWalletSource {
  address: string;
  getEthereumProvider(): Promise<unknown>;
  switchChain(chainId: number): Promise<unknown>;
}
/** Accept the explicitly selected ConnectedWallet from Privy's useWallets(). */
export function walletFromPrivy(wallet: PrivyWalletSource) {
  return createWalletAdapter({
    address: wallet.address,
    getProvider: () => wallet.getEthereumProvider(),
    switchChain: (chainId) => wallet.switchChain(chainId),
  });
}
/** Browser/connector WalletClients only; no private keys or RPC-unlocked accounts. */
export function walletFromViem(
  client: WalletClient,
  provider?: WalletProvider,
) {
  invariant(
    client.account?.type === "json-rpc",
    "UNSUPPORTED_WALLET",
    "Pass a connected JSON-RPC WalletClient. Local/private-key accounts are not supported by this browser widget.",
  );
  return createWalletAdapter({
    address: client.account.address,
    getProvider: async () => provider ?? { request: client.request },
  });
}
