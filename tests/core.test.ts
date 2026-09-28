import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAmount, coreAmount, repayCeiling } from "../src/core/amount";
import { walletAddress } from "../src/core/wallet";
import { resolveConfig } from "../src/core/config";
import { signer } from "../src/core/wallet";
import { normalizeError } from "../src/core/errors";
import {
  clearLegacyTransactions,
  withOperationLock,
} from "../src/core/operations";
import { hyperliquid } from "viem/chains";
import type { WalletProvider, OperationRecord } from "../src/types";
const owner = "0x1111111111111111111111111111111111111111",
  other = "0x2222222222222222222222222222222222222222",
  projectId = `0x${"ab".repeat(32)}` as const;
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("amounts", () => {
  it("never loses large integer or six-decimal precision", () =>
    expect(parseAmount("9007199254.740993")).toBe(9007199254740993n));
  it.each(["1e3", "-1", "0", "1.0000001", "NaN", "Infinity", "1,000"])(
    "rejects %s",
    (s) => expect(() => parseAmount(s)).toThrow(),
  );
  it("floors Core 8-decimal dust", () =>
    expect(coreAmount("1.23456789")).toBe(1234567n));
  it("buffers full repayment only within uint128", () => {
    expect(repayCeiling(1000000n)).toBe(1001000n);
    expect(repayCeiling((1n << 128n) - 1n)).toBe((1n << 128n) - 1n);
  });
});
describe("configuration and truth", () => {
  it("requires a valid project", () => {
    expect(() =>
      resolveConfig({
        projectId: "0x00",
        network: "mainnet",
      }),
    ).toThrow();
  });
  it("separates instance configurations and pairs Arbitrum networks", () => {
    const a = resolveConfig({
      projectId,
      network: "testnet",
      arbitrumWithdrawalEnabled: true,
    });
    const b = resolveConfig({
      projectId,
      network: "mainnet",
    });
    a.features.borrow = false;
    expect(b.features.borrow).toBe(true);
    expect(a.arbitrumWithdrawalEnabled).toBe(true);
    expect(a.arbitrumChain.id).toBe(421614);
    expect(b.arbitrumChain.id).toBe(42161);
    expect(a.arbitrumRpcUrl).toBe(a.arbitrumChain.rpcUrls.default.http[0]);
    expect(b.arbitrumWithdrawalEnabled).toBe(true);
    expect(
      resolveConfig({
        projectId,
        network: "mainnet",
        arbitrumWithdrawalEnabled: false,
      }).arbitrumWithdrawalEnabled,
    ).toBe(false);
    expect(a.factory).not.toBe(b.factory);
  });
  it("accepts all features disabled and defaults account details on", () => {
    expect(
      resolveConfig({ projectId, network: "testnet" }).features.tradingAccount,
    ).toBe(true);
    expect(
      Object.values(
        resolveConfig({
          projectId,
          network: "testnet",
          features: {
            tradingAccount: false,
            borrow: false,
            repay: false,
            deposit: false,
            transfer: false,
            withdraw: false,
          },
        }).features,
      ).some(Boolean),
    ).toBe(false);
  });
  it("gets identity from the host wallet without login signatures", async () => {
    const request = vi.fn(async () => [owner]);
    expect(await walletAddress({ request } as unknown as WalletProvider)).toBe(
      owner,
    );
    expect(request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });
});
describe("wallet guard", () => {
  function provider(address = owner, chain = 999) {
    return {
      request: vi.fn(
        async ({ method, params }: { method: string; params?: unknown }) => {
          if (method === "eth_accounts") return [address];
          if (method === "eth_chainId") return `0x${chain.toString(16)}`;
          if (method === "wallet_switchEthereumChain") {
            chain = Number((params as { chainId: string }[])[0].chainId);
            return null;
          }
          throw Error(method);
        },
      ),
    } as unknown as WalletProvider;
  }
  it("rejects a different active wallet before any signing request", async () => {
    const p = provider(other);
    await expect(
      signer(p, owner, hyperliquid, () => true),
    ).rejects.toMatchObject({ code: "OWNER_WALLET_MISMATCH" });
    expect(p.request).toHaveBeenCalledTimes(1);
  });
  it("switches and rechecks the actual chain", async () => {
    const p = provider(owner, 1);
    const w = await signer(p, owner, hyperliquid, () => true);
    expect(w.account.address).toBe(owner);
    expect(p.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x3e7" }],
    });
  });
  it("never proceeds after switch rejection", async () => {
    const p = provider(owner, 1);
    const original = p.request;
    p.request = vi.fn(async (args: { method: string }) => {
      if (args.method === "wallet_switchEthereumChain") throw { code: 4001 };
      return (
        original as unknown as (args: { method: string }) => Promise<unknown>
      )(args);
    }) as unknown as WalletProvider["request"];
    await expect(signer(p, owner, hyperliquid, () => true)).rejects.toEqual({
      code: 4001,
    });
  });
  it("adds a missing chain only on 4902, then rechecks the selected network", async () => {
    let chain = 1,
      added = false;
    const request = vi.fn(
      async ({ method, params }: { method: string; params?: unknown }) => {
        if (method === "eth_accounts") return [owner];
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "wallet_switchEthereumChain") {
          if (!added) throw { cause: { code: 4902 } };
          chain = 999;
          return null;
        }
        if (method === "wallet_addEthereumChain") {
          added = true;
          return null;
        }
      },
    );
    await signer(
      { request } as unknown as WalletProvider,
      owner,
      hyperliquid,
      () => true,
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "wallet_addEthereumChain",
        params: [
          expect.objectContaining({
            chainId: "0x3e7",
            chainName: hyperliquid.name,
          }),
        ],
      }),
    );
    expect(chain).toBe(999);
  });
  it("normalizes nested wallet cancellation", () =>
    expect(normalizeError({ cause: { code: 4001 } }).code).toBe(
      "USER_REJECTED",
    ));
});
describe("recovery and concurrency", () => {
  const op: OperationRecord = {
    id: "op-1",
    network: "mainnet",
    projectId,
    owner,
    action: "borrow",
    chainId: 999,
    stage: "confirming",
    hash: `0x${"ac".repeat(32)}`,
    createdAt: 1,
  };
  it("cleans up obsolete records without touching preferences", () => {
    localStorage.setItem("leveracc:widget:v1:broken", "{invalid");
    localStorage.setItem("leveracc:widget:gas:old", JSON.stringify(op));
    localStorage.setItem("preference", "dark");
    clearLegacyTransactions();
    expect(Object.keys(localStorage)).toEqual(["preference"]);
  });
  it("allows denied storage", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw Error("denied");
    });
    localStorage.setItem("leveracc:widget:v1:broken", "bad");
    expect(clearLegacyTransactions).not.toThrow();
  });
  it("blocks overlapping operations for the same identity", async () => {
    let release!: () => void;
    const held = withOperationLock(
      op,
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    await expect(withOperationLock(op, async () => {})).rejects.toMatchObject({
      code: "OPERATION_BUSY",
    });
    release();
    await held;
    await expect(withOperationLock(op, async () => 42)).resolves.toBe(42);
  });
});
