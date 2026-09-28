import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/core/config";
const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  readContract: vi.fn(),
  getBalance: vi.fn(),
}));
vi.mock("../src/protocol/port", () => ({ publicRpc: () => rpc }));
import { bridgeClients } from "../src/bridge/client";
const owner = "0x1111111111111111111111111111111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  rpc.readContract.mockResolvedValue(1n);
  rpc.getBalance.mockResolvedValue(2n);
});
describe.each(["testnet", "mainnet"] as const)("%s bridge RPC", (network) => {
  const config = resolveConfig({ network, projectId: `0x${"ab".repeat(32)}` });
  it("rejects the opposite network before reading balances or allowances", async () => {
    rpc.getChainId.mockResolvedValue(network === "testnet" ? 42161 : 421614);
    await expect(bridgeClients(config).balances(owner)).rejects.toMatchObject({
      code: "RPC_NETWORK_MISMATCH",
    });
    expect(rpc.readContract).not.toHaveBeenCalled();
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });
  it("reads balances on the configured network", async () => {
    rpc.getChainId.mockResolvedValue(config.arbitrumChain.id);
    await expect(bridgeClients(config).balances(owner)).resolves.toEqual({
      balance: 1n,
      allowance: 1n,
      gas: 2n,
    });
  });
});
