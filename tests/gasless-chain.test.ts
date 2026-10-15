import { beforeEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/core/config";
const h = vi.hoisted(() => ({
  eth: vi.fn(),
  usdc: vi.fn(),
  gas: vi.fn(),
  fees: vi.fn(),
  chain: vi.fn(),
}));
vi.mock("../src/protocol/port", () => ({
  publicRpc: () => ({
    getChainId: h.chain,
    getBalance: h.eth,
    readContract: h.usdc,
    estimateContractGas: h.gas,
    estimateFeesPerGas: h.fees,
  }),
}));
import { readGaslessFunding } from "../src/protocol/gasless-chain";
import { owner, receiver } from "./gasless-fixtures";
const config = resolveConfig({
  network: "mainnet",
  projectId: `0x${"ab".repeat(32)}`,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.chain.mockResolvedValue(42161);
  h.eth.mockResolvedValue(0n);
  h.usdc.mockResolvedValue(4000000n);
  h.gas.mockResolvedValue(100n);
  h.fees.mockResolvedValue({ maxFeePerGas: 10n });
});
it("estimates the actual payment with only native balance overridden and 20% headroom", async () => {
  expect(
    await readGaslessFunding(config, owner, receiver, 1100000n),
  ).toMatchObject({ required: 1200n, sufficient: false });
  expect(h.gas.mock.calls[0][0]).toMatchObject({
    args: [receiver, 1100000n],
    stateOverride: [{ address: owner, balance: 10n ** 20n }],
  });
  h.eth.mockResolvedValue(1199n);
  expect(
    (await readGaslessFunding(config, owner, receiver, 3000000n)).sufficient,
  ).toBe(false);
  h.eth.mockResolvedValue(1200n);
  expect(
    (await readGaslessFunding(config, owner, receiver, 3000000n)).sufficient,
  ).toBe(true);
});
it("does not treat RPC errors or insufficient reserves as zero ETH", async () => {
  h.usdc.mockResolvedValue(2999999n);
  await expect(
    readGaslessFunding(config, owner, receiver, 3000000n),
  ).rejects.toThrow("reserveInsufficient");
  h.usdc.mockRejectedValue(Error("rpc failed"));
  await expect(
    readGaslessFunding(config, owner, receiver, 3000000n),
  ).rejects.toThrow("rpc failed");
});
