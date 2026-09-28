import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/core/config";
import { CCTP, CCTP_TESTNET } from "../src/bridge/cctp";
import type { AccountState } from "../src/protocol/account";
import type { ProtocolPort } from "../src/protocol/port";
const mocks = vi.hoisted(() => ({ circle: vi.fn() }));
vi.mock("../src/bridge/cctp-api", () => ({ circleJson: mocks.circle }));
import { withdrawArbitrum } from "../src/bridge/submit";
const owner = `0x${"11".repeat(20)}` as const;
const account = `0x${"22".repeat(20)}` as const;
const hash = `0x${"ab".repeat(32)}` as const;
beforeEach(() =>
  mocks.circle.mockResolvedValue([
    { finalityThreshold: 2000, minimumFee: 0, forwardFee: { high: "100000" } },
  ]),
);
describe.each(["mainnet", "testnet"] as const)(
  "%s Trade withdrawal",
  (network) => {
    const config = resolveConfig({
      network,
      projectId: hash,
      arbitrumWithdrawalEnabled: true,
    });
    const deployment = network === "testnet" ? CCTP_TESTNET : CCTP;
    const state = {
      account,
      asset: deployment.evmUsdc,
      projectId: hash,
      nonce: 3n,
    } as unknown as AccountState;
    function setup() {
      return {
        read: vi.fn(async ({ functionName }) => {
          if (functionName === "getAccountRuntimeStatus")
            return {
              availableAssetBalance: 11000000n,
              payableInterestNow: 1000000n,
            };
          if (functionName === "previewSafeUserClaimablePrimaryDirect")
            return 10000000n;
          return { netPayoutAmount: 10000000n };
        }),
        coreSpotBalance: vi.fn().mockResolvedValue(0n),
        write: vi.fn().mockResolvedValue(hash),
        sign: vi.fn().mockResolvedValue(hash),
      } as unknown as ProtocolPort;
    }
    it("binds the intent to the source network and matching Arbitrum destination", async () => {
      const port = setup(),
        prepared = vi.fn();
      await withdrawArbitrum(
        port,
        config,
        owner,
        state,
        10000000n,
        100000n,
        prepared,
      );
      expect(port.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: network === "testnet" ? 998 : 999,
          }),
          message: expect.objectContaining({
            destinationChainId: network === "testnet" ? 421614n : 42161n,
          }),
        }),
      );
      expect(mocks.circle).toHaveBeenLastCalledWith(
        undefined,
        "arbitrum",
        network,
      );
      expect(prepared).toHaveBeenCalledWith(
        expect.objectContaining({ network, sourceAccount: account }),
      );
      expect(port.write).toHaveBeenCalledWith(
        expect.objectContaining({
          address: account,
          functionName: "withdrawToArbitrum",
        }),
      );
    });
    it("rejects the other network's USDC before signing", async () => {
      const port = setup();
      await expect(
        withdrawArbitrum(
          port,
          config,
          owner,
          {
            ...state,
            asset: network === "testnet" ? CCTP.evmUsdc : CCTP_TESTNET.evmUsdc,
          },
          10000000n,
          100000n,
          vi.fn(),
        ),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_ASSET" });
      expect(port.sign).not.toHaveBeenCalled();
      expect(port.write).not.toHaveBeenCalled();
    });
    it("retains the deployment opt-in", async () => {
      const port = setup();
      await expect(
        withdrawArbitrum(
          port,
          { ...config, arbitrumWithdrawalEnabled: false },
          owner,
          state,
          10000000n,
          100000n,
          vi.fn(),
        ),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
      expect(port.sign).not.toHaveBeenCalled();
    });
  },
);
