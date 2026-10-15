import { afterEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/core/config";
import { gaslessRequest } from "../src/protocol/gasless-service";
import { getGaslessStatus, prepareGasless } from "../src/protocol/gasless-api";
const config = resolveConfig({
  network: "mainnet",
  projectId: `0x${"ab".repeat(32)}`,
  protocolServiceUrl: "https://gasless.example.test",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("unwraps service data and keeps the recovery token in the status header", async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ data: { phase: "processing" } })),
  );
  vi.stubGlobal("fetch", fetch);
  const pair = {
    trade_hash: `0x${"ab".repeat(32)}` as const,
    quote_token: "private-token",
  };
  expect(await getGaslessStatus(config, pair)).toEqual({ phase: "processing" });
  const [url, init] = (
    fetch.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe(
    `${config.protocolServiceUrl}/api/v1/gas-top-ups/status/${pair.trade_hash}?source_chain_id=42161`,
  );
  expect(url).not.toContain(pair.quote_token);
  expect(init.headers).toMatchObject({ "X-Gasless-Quote": pair.quote_token });
  expect(init.cache).toBe("no-store");
});
it("sends prepare proof with the configured service", async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ quote_token: "token" })),
  );
  vi.stubGlobal("fetch", fetch);
  const body = {
    user_eoa: "owner",
    source_chain_id: 42161,
    sell_token: "USDC",
    sell_amount_raw: "1000000",
    timestamp: 1,
    wallet_signature: "0x12" as const,
  };
  await prepareGasless(config, body);
  const [url, init] = (
    fetch.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe(`${config.protocolServiceUrl}/api/v1/gas-top-ups/prepare`);
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual(body);
});
it("honors service cooldowns without leaking upstream messages", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "sensitive upstream data" }), {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
    )
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { enabled: true } })),
    );
  vi.stubGlobal("fetch", fetch);
  const isolated = {
    ...config,
    protocolServiceUrl: "https://cooldown.example.test",
  };
  await expect(gaslessRequest(isolated, "/config")).rejects.toMatchObject({
    message: "serviceError",
    retryAfterMs: 30000,
  });
  await expect(gaslessRequest(isolated, "/config")).rejects.toMatchObject({
    status: 429,
    requestSent: false,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);
  expect(await gaslessRequest(isolated, "/config")).toEqual({ enabled: true });
});
