import { afterEach, expect, it, vi } from "vitest";
import { hasCreationTopUp } from "../src/protocol/gas-top-ups";
import { resolveConfig } from "../src/core/config";
const owner = "0x1111111111111111111111111111111111111111";
const paid = {
  requested_usdc_amount_raw: "3000000",
  phase: "success",
  terminal: true,
};
afterEach(() => vi.unstubAllGlobals());
function respond(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status })),
  );
}
it.each([
  [paid],
  { items: [paid] },
  { data: [paid] },
  { data: { items: [paid] } },
])("accepts supported history envelope %#", async (payload) => {
  respond(payload);
  expect(await hasCreationTopUp("https://service.test/", owner)).toBe(true);
  expect(fetch).toHaveBeenCalledWith(
    `https://service.test/api/v1/gas-top-ups?user_eoa=${owner}`,
    expect.objectContaining({ cache: "no-store" }),
  );
});
it("finds old success and ignores nonqualifying records", async () => {
  const invalid = [
    { ...paid, phase: "processing" },
    { ...paid, phase: "failed" },
    { ...paid, terminal: false },
    { ...paid, requested_usdc_amount_raw: "6000000" },
    { ...paid, requested_usdc_amount_raw: "1500000" },
    { ...paid, requested_usdc_amount_raw: "1500000" },
    null,
  ];
  respond(invalid);
  expect(await hasCreationTopUp("https://service.test", owner)).toBe(false);
  respond([...invalid, paid]);
  expect(await hasCreationTopUp("https://service.test", owner)).toBe(true);
});
it.each([null, {}, { data: null }, { items: "bad" }])(
  "rejects malformed history %#",
  async (payload) => {
    respond(payload);
    await expect(
      hasCreationTopUp("https://service.test", owner),
    ).rejects.toThrow("Invalid gas");
  },
);
it("rejects service failures", async () => {
  respond({}, 503);
  await expect(hasCreationTopUp("https://service.test", owner)).rejects.toThrow(
    "Unable to check",
  );
});
it("defaults service by network and validates overrides", () => {
  const config = {
    network: "mainnet" as const,
    projectId: `0x${"ab".repeat(32)}` as `0x${string}`,
  };
  expect(resolveConfig(config).protocolServiceUrl).toBe(
    "https://protocol-service.leveracc.xyz",
  );
  expect(
    resolveConfig({ ...config, network: "testnet" }).protocolServiceUrl,
  ).toBe("https://protocol-service-testnet.leveracc.xyz");
  expect(
    resolveConfig({ ...config, protocolServiceUrl: "https://service.test/" })
      .protocolServiceUrl,
  ).toBe("https://service.test");
  expect(() =>
    resolveConfig({ ...config, protocolServiceUrl: "file:///tmp/service" }),
  ).toThrow();
});

it("validates and defaults the creation history opt-out", () => {
  const config = {
    network: "mainnet" as const,
    projectId: `0x${"ab".repeat(32)}` as `0x${string}`,
  };
  expect(resolveConfig(config).skipCreationTopUpCheck).toBe(false);
  for (const value of [true, false]) {
    expect(
      resolveConfig({ ...config, skipCreationTopUpCheck: value })
        .skipCreationTopUpCheck,
    ).toBe(value);
  }
  for (const value of [null, 1, "true", {}]) {
    expect(() =>
      resolveConfig({ ...config, skipCreationTopUpCheck: value as boolean }),
    ).toThrow("must be a boolean");
  }
});

it("defaults independent creation flags and distinguishes legacy configurations", () => {
  const base = {
    network: "mainnet" as const,
    projectId: `0x${"ab".repeat(32)}` as const,
  };
  expect(resolveConfig(base)).toMatchObject({
    creationLegacyMode: true,
    creationGasConversionEnabled: true,
    creationAccountActivationEnabled: true,
  });
  expect(
    resolveConfig({ ...base, creationGasConversionEnabled: false }),
  ).toMatchObject({
    creationLegacyMode: false,
    creationGasConversionEnabled: false,
    creationAccountActivationEnabled: true,
  });
  for (const key of [
    "creationGasConversionEnabled",
    "creationAccountActivationEnabled",
  ]) {
    for (const value of [null, "false", 0])
      expect(() => resolveConfig({ ...base, [key]: value })).toThrow(
        "must be a boolean",
      );
  }
});
