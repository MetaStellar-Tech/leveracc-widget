import {
  createWalletClient,
  custom,
  isAddress,
  type Address,
  type Chain,
  type WalletClient,
  type Transport,
  type Account,
} from "viem";
import type { WalletProvider } from "../types";
import { invariant } from "./errors";
export async function walletAddress(
  provider: WalletProvider,
  request = false,
): Promise<Address> {
  const result = await provider.request({
    method: request ? "eth_requestAccounts" : "eth_accounts",
  });
  invariant(
    Array.isArray(result) && isAddress(result[0]),
    "WALLET_NOT_CONNECTED",
    "Connect your wallet in the host application.",
  );
  return result[0];
}
export async function signer(
  provider: WalletProvider,
  owner: Address,
  chain: Chain,
  current: () => boolean,
): Promise<WalletClient<Transport, Chain, Account>> {
  invariant(
    current(),
    "CONTEXT_CHANGED",
    "Wallet or widget configuration changed.",
  );
  invariant(
    (await walletAddress(provider)).toLowerCase() === owner.toLowerCase(),
    "OWNER_WALLET_MISMATCH",
    "Select the owner wallet for this operation.",
  );
  if (Number(await provider.request({ method: "eth_chainId" })) !== chain.id) {
    const switchChain = () =>
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chain.id.toString(16)}` }],
      });
    try {
      await switchChain();
    } catch (error) {
      let cause: unknown = error;
      let missing = false;
      for (let depth = 0; cause && depth < 8; depth++) {
        const value = cause as { code?: number; cause?: unknown };
        if (value.code === 4902) {
          missing = true;
          break;
        }
        cause = value.cause;
      }
      if (!missing) throw error;
      invariant(current(), "CONTEXT_CHANGED", "Widget configuration changed.");
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${chain.id.toString(16)}`,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [...chain.rpcUrls.default.http],
            ...(chain.blockExplorers?.default
              ? { blockExplorerUrls: [chain.blockExplorers.default.url] }
              : {}),
          },
        ],
      });
      invariant(current(), "CONTEXT_CHANGED", "Widget configuration changed.");
      await switchChain();
    }
  }
  invariant(current(), "CONTEXT_CHANGED", "Widget configuration changed.");
  invariant(
    (await walletAddress(provider)).toLowerCase() === owner.toLowerCase(),
    "OWNER_WALLET_MISMATCH",
    "Wallet account changed.",
  );
  invariant(
    Number(await provider.request({ method: "eth_chainId" })) === chain.id,
    "OWNER_NETWORK_MISMATCH",
    "Wallet network did not switch.",
  );
  return createWalletClient({
    account: owner,
    chain,
    transport: custom(provider),
  });
}
