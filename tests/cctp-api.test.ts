import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CircleApiError,
  circleJson,
  circleUrl,
  cctpRetry,
  cctpRetryDelay,
} from "../src/bridge/cctp-api";

afterEach(() => vi.unstubAllGlobals());
describe("Circle browser API", () => {
  it("separates Fund and Core quotes without a server proxy", () => {
    expect(circleUrl(undefined, "fund")).toBe(
      "https://iris-api.circle.com/v2/burn/USDC/fees/3/19?forward=true",
    );
    expect(circleUrl(undefined, "arbitrum")).toBe(
      "https://iris-api.circle.com/v2/burn/USDC/fees/19/3?forward=true",
    );
    expect(circleUrl(`0x${"ab".repeat(32)}`, "arbitrum")).toContain(
      "/messages/19?transactionHash=",
    );
    expect(circleUrl()).toContain("&hyperCoreDeposit=true");
    expect(() => circleUrl("bad")).toThrow();
  });
  it("uses the sandbox for testnet fees and attestations", async () => {
    expect(circleUrl(undefined, "arbitrum", "testnet")).toBe(
      "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/19/3?forward=true",
    );
    const fetcher = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal("fetch", fetcher);
    await circleJson(`0x${"ab".repeat(32)}`, "arbitrum", "testnet");
    expect(fetcher.mock.calls[0][0]).toContain(
      "https://iris-api-sandbox.circle.com/v2/messages/19?",
    );
    expect(circleUrl(undefined, "fund", "testnet")).toBe(
      "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/3/19?forward=true",
    );
    expect(() => circleUrl(undefined, "core", "testnet")).toThrow();
  });
  it("maps missing attestations to pending and omits credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal("fetch", fetcher);
    expect(await circleJson(`0x${"ab".repeat(32)}`, "fund")).toEqual({
      messages: [],
    });
    expect(fetcher.mock.calls[0][1].credentials).toBe("omit");
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("respects rate limits with bounded retry and delay", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("", { status: 429, headers: { "Retry-After": "30" } }),
        ),
    );
    const error = await circleJson().catch((error) => error);
    expect(error).toBeInstanceOf(CircleApiError);
    expect(cctpRetryDelay(0, error)).toBe(30000);
    expect(cctpRetryDelay(100, new CircleApiError(429, 999999))).toBe(60000);
    expect(cctpRetry(0, error)).toBe(true);
    expect(cctpRetry(2, error)).toBe(false);
    expect(cctpRetry(0, new CircleApiError(400))).toBe(false);
  });
  it("propagates timeout and network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(circleJson()).rejects.toThrow("timeout");
  });
});
