import { describe, expect, it, vi } from "vitest";
import { createWalletClient, custom, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hyperliquidEvmTestnet } from "viem/chains";
import {
  createWalletAdapter,
  walletFromViem,
  walletFromWagmi,
  walletFromPrivy,
} from "../src/wallets";
import type { WalletProvider } from "../src/types";
const owner = "0x1111111111111111111111111111111111111111",
  other = "0x2222222222222222222222222222222222222222";
function provider(accounts: string[] = [owner], chain = 998) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const p = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return accounts;
      if (method === "eth_chainId") return `0x${chain.toString(16)}`;
      return "0xsigned";
    }),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    removeListener: vi.fn((event: string, fn: (...args: unknown[]) => void) =>
      listeners.get(event)?.delete(fn),
    ),
  };
  return {
    p: p as unknown as WalletProvider,
    request: p.request,
    listeners,
    setAccounts: (next: string[]) => {
      accounts = next;
      listeners.get("accountsChanged")?.forEach((fn) => fn(next));
    },
    setChain: (next: number) => {
      chain = next;
    },
  };
}
describe("wallet SDK adapters", () => {
  it("uses the host-selected account, not the first provider account", async () => {
    const { p } = provider([other, owner]);
    const wallet = await createWalletAdapter({
      address: owner,
      getProvider: async () => p,
    });
    expect(await wallet.request({ method: "eth_accounts" })).toEqual([owner]);
    wallet.destroy();
  });
  it("does not synthesize a selected account that the wallet has not authorized", async () => {
    const { p, request } = provider([other]);
    const wallet = await createWalletAdapter({
      address: owner,
      getProvider: async () => p,
    });
    await expect(
      wallet.request({ method: "eth_signTypedData_v4", params: [owner, "{}"] }),
    ).rejects.toMatchObject({ code: "OWNER_WALLET_MISMATCH" });
    expect(
      request.mock.calls.some(
        ([call]) => call.method === "eth_signTypedData_v4",
      ),
    ).toBe(false);
  });
  it("uses wagmi connector switchChain and reacquires its provider", async () => {
    const first = provider([owner], 1),
      second = provider();
    let p = first.p;
    const switchChain = vi.fn(async () => {
      p = second.p;
    });
    const wallet = await walletFromWagmi(
      { getProvider: async () => p, switchChain },
      owner,
    );
    const listener = vi.fn();
    wallet.on?.("chainChanged", listener);
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x3e6" }],
    });
    expect(switchChain).toHaveBeenCalledWith({ chainId: 998 });
    expect(listener).toHaveBeenCalledWith("0x3e6");
    expect(first.listeners.get("chainChanged")?.size).toBe(0);
    expect(second.listeners.get("chainChanged")?.size).toBe(1);
    wallet.destroy();
    expect(second.listeners.get("chainChanged")?.size).toBe(0);
  });
  it("uses Privy switchChain rather than assuming the raw provider supports switching", async () => {
    const { p, setChain } = provider([owner], 1),
      switchChain = vi.fn(async (id: number) => setChain(id));
    const wallet = await walletFromPrivy({
      address: owner,
      getEthereumProvider: async () => p,
      switchChain,
    });
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x3e6" }],
    });
    expect(switchChain).toHaveBeenCalledWith(998);
    expect(await wallet.request({ method: "eth_chainId" })).toBe("0x3e6");
  });
  it("rechecks the actual chain after a connector claims success", async () => {
    const { p } = provider([owner], 1);
    const wallet = await walletFromPrivy({
      address: owner,
      getEthereumProvider: async () => p,
      switchChain: async () => {},
    });
    await expect(
      wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x3e6" }],
      }),
    ).rejects.toMatchObject({ code: "OWNER_NETWORK_MISMATCH" });
  });
  it("propagates SDK rejection without retrying signatures", async () => {
    const { p } = provider();
    const switchChain = vi.fn(async () => {
      throw { code: 4001 };
    });
    const wallet = await walletFromWagmi(
      { getProvider: async () => p, switchChain },
      owner,
    );
    await expect(
      wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x3e6" }],
      }),
    ).rejects.toEqual({ code: 4001 });
    expect(switchChain).toHaveBeenCalledTimes(1);
  });
  it("forwards account events and invalidates a destroyed selection", async () => {
    const { p, setAccounts, listeners } = provider();
    const wallet = await walletFromPrivy({
      address: owner,
      getEthereumProvider: async () => p,
      switchChain: async () => {},
    });
    const accountChange = vi.fn(),
      disconnect = vi.fn();
    wallet.on?.("accountsChanged", accountChange);
    wallet.on?.("disconnect", disconnect);
    setAccounts([]);
    expect(accountChange).toHaveBeenCalledWith([]);
    expect(await wallet.request({ method: "eth_accounts" })).toEqual([]);
    wallet.destroy();
    wallet.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(listeners.get("accountsChanged")?.size).toBe(0);
    await expect(
      wallet.request({ method: "eth_accounts" }),
    ).rejects.toMatchObject({ code: "WALLET_DISCONNECTED" });
  });
  it("bridges a viem JSON-RPC WalletClient and rejects local private-key clients", async () => {
    const { p } = provider();
    const client = createWalletClient({
      account: owner,
      chain: hyperliquidEvmTestnet,
      transport: custom(p),
    });
    const wallet = await walletFromViem(client, p);
    expect(await wallet.request({ method: "eth_accounts" })).toEqual([owner]);
    const local = createWalletClient({
      account: privateKeyToAccount(`0x${"01".repeat(32)}`),
      transport: http("https://unused.test"),
    });
    expect(() => walletFromViem(local)).toThrow(
      "Local/private-key accounts are not supported",
    );
  });
});
