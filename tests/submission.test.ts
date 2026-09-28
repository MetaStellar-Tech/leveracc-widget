import { beforeEach, expect, it, vi } from "vitest";
import type { WalletProvider } from "../src/types";
import { resolveConfig } from "../src/core/config";
const m = vi.hoisted(() => ({
  write: vi.fn(),
  receipt: vi.fn(),
  send: vi.fn(),
  guard: vi.fn(),
}));
vi.mock("../src/core/wallet", () => ({
  signer: async () => ({ writeContract: m.write }),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({
    getChainId: async () => 998,
    simulateContract: async (request: unknown) => ({ request }),
    waitForTransactionReceipt: m.receipt,
  }),
}));
vi.mock("@nktkas/hyperliquid", () => ({
  ExchangeClient: class {
    sendAsset = m.send;
  },
  HttpTransport: class {},
}));
import { createPort } from "../src/protocol/port";
const hash = `0x${"ab".repeat(32)}` as const;
const owner = "0x1111111111111111111111111111111111111111";
const config = resolveConfig({ projectId: hash, network: "testnet" });
beforeEach(() => {
  vi.resetAllMocks();
  m.write.mockResolvedValue(hash);
  m.send.mockResolvedValue(undefined);
  m.receipt.mockImplementation(() => new Promise(() => {}));
});
function port(progress = vi.fn()) {
  return createPort(
    config,
    {} as WalletProvider,
    owner,
    () => true,
    progress,
    m.guard,
  );
}
it("returns an EVM hash without starting a receipt request", async () => {
  const progress = vi.fn();
  await expect(
    port(progress).write({ address: owner, abi: [], functionName: "submit" }),
  ).resolves.toBe(hash);
  expect(progress).toHaveBeenLastCalledWith("submitted", hash);
  expect(m.receipt).not.toHaveBeenCalled();
});
it("reports Core submission when the API acknowledges it", async () => {
  const progress = vi.fn();
  await port(progress).sendCore(owner, "3");
  expect(progress).toHaveBeenLastCalledWith("submitted");
  expect(m.receipt).not.toHaveBeenCalled();
});
it("never reports a rejected Core API request as submitted", async () => {
  m.send.mockRejectedValueOnce(Error("request failed"));
  const progress = vi.fn();
  await expect(port(progress).sendCore(owner, "3")).rejects.toThrow(
    "request failed",
  );
  expect(progress).not.toHaveBeenCalledWith("submitted");
});
