import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ spot: vi.fn(), transport: vi.fn() }));
vi.mock("@nktkas/hyperliquid", () => ({
  InfoClient: class {
    spotClearinghouseState = mock.spot;
  },
  HttpTransport: mock.transport,
  ExchangeClient: class {},
}));
import { createPort } from "../src/protocol/port";
import { resolveConfig } from "../src/core/config";
import type { WalletProvider } from "../src/types";
const account = `0x${"22".repeat(20)}` as const;
const config = resolveConfig({
  network: "mainnet",
  projectId: `0x${"11".repeat(32)}`,
});
const port = () =>
  createPort(
    config,
    {} as WalletProvider,
    account,
    () => true,
    () => {},
    async () => {},
  );
beforeEach(() => vi.clearAllMocks());
it.each([
  ["25.12345601", "1.00000099", 24123456n],
  ["1", "2", 0n],
  ["0.005", "0", 5000n],
])(
  "subtracts separately truncated total %s and hold %s",
  async (total, hold, expected) => {
    mock.spot.mockResolvedValue({ balances: [{ coin: "USDC", total, hold }] });
    expect(await port().coreSpotBalance(account)).toBe(expected);
    expect(mock.spot).toHaveBeenCalledWith({ user: account });
    expect(mock.transport).toHaveBeenCalledWith({ isTestnet: false });
  },
);
it("distinguishes absent USDC from unavailable or malformed balances", async () => {
  mock.spot.mockResolvedValueOnce({ balances: [] });
  expect(await port().coreSpotBalance(account)).toBe(0n);
  mock.spot.mockResolvedValueOnce({});
  await expect(port().coreSpotBalance(account)).rejects.toThrow();
  mock.spot.mockResolvedValueOnce({
    balances: [{ coin: "USDC", total: "bad", hold: "0" }],
  });
  await expect(port().coreSpotBalance(account)).rejects.toThrow();
  mock.spot.mockRejectedValueOnce(new Error("offline"));
  await expect(port().coreSpotBalance(account)).rejects.toThrow("offline");
});
