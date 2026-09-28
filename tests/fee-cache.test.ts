import { afterEach, expect, it, vi } from "vitest";
import { CircleFeeCache } from "../src/bridge/fee-cache";

afterEach(() => vi.unstubAllGlobals());
const data = (high = "100") =>
  [1000, 2000].map((finalityThreshold) => ({
    finalityThreshold,
    minimumFee: 1,
    forwardFee: { high },
  }));
it("shares parameters across amounts and concurrent reads, isolates routes, networks and instances", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => data() });
  vi.stubGlobal("fetch", fetcher);
  const cache = new CircleFeeCache();
  expect(
    await Promise.all([
      cache.quote(1n, "arbitrum", "mainnet"),
      cache.quote(10001n, "arbitrum", "mainnet"),
    ]),
  ).toEqual([101n, 102n]);
  await cache.quote(0n, "arbitrum", "mainnet");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await cache.quote(1n, "arbitrum", "testnet");
  await cache.quote(1n, "fund", "mainnet");
  await new CircleFeeCache().quote(1n, "arbitrum", "mainnet");
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("refreshes submission fees and retries failed or malformed parameters", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => data() });
  vi.stubGlobal("fetch", fetcher);
  const cache = new CircleFeeCache();
  await cache.quote(1n, "arbitrum", "mainnet");
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => data("200") });
  expect(await cache.quote(1n, "arbitrum", "mainnet", true)).toBe(201n);
  expect(await cache.quote(10001n, "arbitrum", "mainnet")).toBe(202n);
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(cache.quote(1n, "arbitrum", "mainnet", true)).rejects.toThrow(
    "offline",
  );
  expect(await cache.quote(1n, "arbitrum", "mainnet")).toBe(101n);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => [] });
  await expect(cache.quote(1n, "arbitrum", "mainnet", true)).rejects.toThrow();
  expect(await cache.quote(1n, "arbitrum", "mainnet")).toBe(101n);
});
