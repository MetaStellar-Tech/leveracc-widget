import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { useWidgetWallet, usePrivyWidgetWallet } from "../src/wallets/react";
import type { WalletAdapter, PrivyWalletSource } from "../src/wallets";
const owner = "0x1111111111111111111111111111111111111111";
let root: Root, container: HTMLDivElement;
let result: ReturnType<typeof useWidgetWallet>;
function Generic({ create }: { create?: () => Promise<WalletAdapter> }) {
  result = useWidgetWallet(create);
  return null;
}
function Privy({ wallet }: { wallet?: PrivyWalletSource }) {
  result = usePrivyWidgetWallet(wallet);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function adapter() {
  return { request: vi.fn(), destroy: vi.fn() } as unknown as WalletAdapter;
}
describe("SDK wallet lifecycle hooks", () => {
  it("discards a late old provider and cleans up the active selection", async () => {
    let resolve!: (wallet: WalletAdapter) => void;
    const old = adapter(),
      next = adapter();
    const a = () =>
        new Promise<WalletAdapter>((r) => {
          resolve = r;
        }),
      b = async () => next;
    await act(async () => root.render(<Generic create={a} />));
    await act(async () => root.render(<Generic create={b} />));
    expect(result.wallet).toBe(next);
    await act(async () => resolve(old));
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(result.wallet).toBe(next);
    await act(async () => root.render(<Generic />));
    expect(next.destroy).toHaveBeenCalledTimes(1);
    expect(result.wallet).toBeUndefined();
  });
  it("keeps a Privy adapter stable across same-owner SDK object updates and uses latest switch methods", async () => {
    let chain = 1;
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === "eth_chainId" ? `0x${chain.toString(16)}` : [owner],
      ),
    };
    const first: PrivyWalletSource = {
      address: owner,
      getEthereumProvider: async () => provider,
      switchChain: vi.fn(async () => {}),
    };
    await act(async () => root.render(<Privy wallet={first} />));
    const original = result.wallet;
    const second: PrivyWalletSource = {
      ...first,
      switchChain: vi.fn(async (id: number) => {
        chain = id;
      }),
    };
    await act(async () => root.render(<Privy wallet={second} />));
    expect(result.wallet).toBe(original);
    await result.wallet!.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x3e6" }],
    });
    expect(second.switchChain).toHaveBeenCalledWith(998);
    expect(first.switchChain).not.toHaveBeenCalled();
    await act(async () => root.render(<Privy />));
    expect(result.wallet).toBeUndefined();
    await expect(
      original!.request({ method: "eth_accounts" }),
    ).rejects.toMatchObject({ code: "WALLET_DISCONNECTED" });
  });
});
