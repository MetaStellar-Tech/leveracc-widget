import { useEffect, useState, useMemo, useRef } from "react";
import {
  walletFromPrivy,
  type WalletAdapter,
  type PrivyWalletSource,
} from "./index";
/** Resolve asynchronously; discard stale providers after account changes/unmount. */
export function useWidgetWallet(
  create: (() => Promise<WalletAdapter>) | undefined,
) {
  const [state, setState] = useState<{
    source: typeof create;
    wallet?: WalletAdapter;
    error?: Error;
  }>({ source: undefined });
  useEffect(() => {
    let active = true;
    let wallet: WalletAdapter | undefined;
    setState({ source: create });
    if (create)
      void create()
        .then((result) => {
          if (!active) {
            result.destroy();
            return;
          }
          wallet = result;
          setState({ source: create, wallet });
        })
        .catch((error) => {
          if (active)
            setState({
              source: create,
              error: error instanceof Error ? error : new Error(String(error)),
            });
        });
    return () => {
      active = false;
      wallet?.destroy();
    };
  }, [create]);
  return state.source === create
    ? {
        wallet: state.wallet,
        error: state.error,
        loading: !!create && !state.wallet && !state.error,
      }
    : { wallet: undefined, error: undefined, loading: !!create };
}

/** Privy may replace ConnectedWallet objects after a chain change. Keep the
 * adapter stable for the same selected owner, but always use its latest methods. */
export function usePrivyWidgetWallet(selected?: PrivyWalletSource) {
  const latest = useRef(selected);
  latest.current = selected;
  const address = selected?.address.toLowerCase();
  const create = useMemo(() => {
    if (!address) return undefined;
    const current = () => {
      if (!latest.current || latest.current.address.toLowerCase() !== address)
        throw new Error(
          "Selected Privy wallet changed. Reconnect before continuing.",
        );
      return latest.current;
    };
    return () =>
      walletFromPrivy({
        address,
        getEthereumProvider: () => current().getEthereumProvider(),
        switchChain: (chainId) => current().switchChain(chainId),
      });
  }, [address]);
  return useWidgetWallet(create);
}
