import { beforeEach, describe, it, expect, vi } from "vitest";
import { resolveConfig } from "../src/core/config";
const mocks = vi.hoisted(() => ({
  balances: vi.fn(),
  quote: vi.fn(),
  signer: vi.fn(),
  write: vi.fn(),
  simulate: vi.fn(),
  gas: vi.fn(),
  price: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock("../src/bridge/client", () => ({
  bridgeClients: () => ({
    balances: mocks.balances,
    arb: {
      estimateContractGas: mocks.gas,
      getGasPrice: mocks.price,
      simulateContract: mocks.simulate,
      waitForTransactionReceipt: mocks.receipt,
    },
  }),
}));
vi.mock("../src/bridge/cctp-api", () => ({ circleJson: mocks.quote }));
vi.mock("../src/core/wallet", () => ({ signer: mocks.signer }));
import { submitDeposit } from "../src/bridge/submit";
import type { WalletProvider } from "../src/types";
const owner = "0x1111111111111111111111111111111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.balances.mockResolvedValue({
    balance: 10000000n,
    allowance: 10000000n,
    gas: 1000000n,
  });
  mocks.quote.mockResolvedValue([
    { finalityThreshold: 1000, minimumFee: 0, forwardFee: { high: "100000" } },
  ]);
  mocks.signer.mockResolvedValue({ writeContract: mocks.write });
  mocks.write.mockResolvedValue(`0x${"ab".repeat(32)}`);
  mocks.gas.mockResolvedValue(100n);
  mocks.price.mockResolvedValue(1n);
  mocks.receipt.mockResolvedValue({ status: "success" });
});
describe.each(["mainnet", "testnet"] as const)(
  "bridge submission on %s",
  (network) => {
    const config = resolveConfig({
      network,
      projectId: `0x${"ab".repeat(32)}`,
    });

    it("requires a fresh quote confirmation when the fee rises", async () => {
      await expect(
        submitDeposit(
          config,
          {} as WalletProvider,
          owner,
          10000000n,
          99999n,
          false,
          () => true,
          () => {},
        ),
      ).rejects.toMatchObject({ code: "FEE_CHANGED" });
      expect(mocks.write).not.toHaveBeenCalled();
    });
    it("preserves the confirmed ceiling when refreshed fees fall", async () => {
      const progress = vi.fn();
      const result = await submitDeposit(
        config,
        {} as WalletProvider,
        owner,
        10000000n,
        200000n,
        false,
        () => true,
        progress,
      );
      expect(mocks.write.mock.calls[0][0].args[5]).toBe(200000n);
      expect(result?.maxFee).toBe("200000");
      expect(result?.network).toBe(network);
      expect(mocks.quote).toHaveBeenCalledWith(undefined, "fund", network);
      const request = mocks.write.mock.calls[0][0];
      expect(request.chain.id).toBe(network === "testnet" ? 421614 : 42161);
      expect(request.address).toBe(
        network === "testnet"
          ? "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"
          : "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      );
      expect(request.args[1]).toBe(19);
      expect(request.args[3]).toBe(
        network === "testnet"
          ? "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
          : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      );
      expect(progress).toHaveBeenLastCalledWith(
        "submitted",
        result?.hash,
        result,
      );
    });
    it("does not mark source submission as bridge completion", async () => {
      const result = await submitDeposit(
        config,
        {} as WalletProvider,
        owner,
        10000000n,
        200000n,
        false,
        () => true,
        () => {},
      );
      expect(result?.completed).not.toBe(true);
      expect(mocks.receipt).not.toHaveBeenCalled();
    });
    it("requires separate USDC approval", async () => {
      mocks.balances.mockResolvedValue({
        balance: 10000000n,
        allowance: 0n,
        gas: 1000000n,
      });
      await expect(
        submitDeposit(
          config,
          {} as WalletProvider,
          owner,
          10000000n,
          200000n,
          false,
          () => true,
          () => {},
        ),
      ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
      expect(mocks.write).not.toHaveBeenCalled();
      await submitDeposit(
        config,
        {} as WalletProvider,
        owner,
        10000000n,
        200000n,
        true,
        () => true,
        () => {},
      );
      expect(mocks.write.mock.calls[0][0].functionName).toBe("approve");
      expect(mocks.receipt).not.toHaveBeenCalled();
    });
    it("blocks insufficient native gas before submission", async () => {
      mocks.balances.mockResolvedValue({
        balance: 10000000n,
        allowance: 10000000n,
        gas: 1n,
      });
      await expect(
        submitDeposit(
          config,
          {} as WalletProvider,
          owner,
          10000000n,
          200000n,
          false,
          () => true,
          () => {},
        ),
      ).rejects.toMatchObject({ code: "INSUFFICIENT_GAS" });
      expect(mocks.write).not.toHaveBeenCalled();
    });
    it("does not submit after the last wallet guard fails", async () => {
      mocks.signer
        .mockResolvedValueOnce({ writeContract: mocks.write })
        .mockRejectedValueOnce(Error("wallet changed"));
      await expect(
        submitDeposit(
          config,
          {} as WalletProvider,
          owner,
          10000000n,
          200000n,
          false,
          () => true,
          () => {},
        ),
      ).rejects.toThrow("wallet changed");
      expect(mocks.write).not.toHaveBeenCalled();
    });
  },
);
