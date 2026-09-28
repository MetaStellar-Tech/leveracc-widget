import { beforeEach, describe, it, expect, vi } from "vitest";
import { resolveConfig } from "../src/core/config";
import { CCTP, CCTP_TESTNET } from "../src/bridge/cctp";
import type { ProtocolPort } from "../src/protocol/port";
const mocks = vi.hoisted(() => ({ circle: vi.fn() }));
vi.mock("../src/bridge/cctp-api", () => ({ circleJson: mocks.circle }));
import { withdrawFundArbitrum } from "../src/bridge/submit";
const owner = "0x1111111111111111111111111111111111111111";
const config = resolveConfig({
  network: "mainnet",
  projectId: `0x${"ab".repeat(32)}`,
});
const hash = `0x${"ef".repeat(32)}` as const;
function setup(allowance = 10000000n, balance = 10000000n) {
  const write = vi.fn(
      async (_call: Parameters<ProtocolPort["write"]>[0]) => hash,
    ),
    sign = vi.fn();
  const port = {
    read: vi.fn(async ({ functionName }) =>
      functionName === "balanceOf" ? balance : allowance,
    ),
    write,
    sign,
  } as unknown as ProtocolPort;
  const prepared = vi.fn();
  return {
    port,
    write,
    sign,
    prepared,
    run: () =>
      withdrawFundArbitrum(port, config, owner, 10000000n, 100000n, prepared),
  };
}
beforeEach(() => {
  mocks.circle.mockResolvedValue([
    { finalityThreshold: 2000, minimumFee: 0, forwardFee: { high: "100000" } },
  ]);
});
describe("owner Fund withdrawal", () => {
  it("only approves the messenger when allowance is missing and never signs an LA intent", async () => {
    const s = setup(0n);
    await s.run();
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(s.write.mock.calls[0]).toEqual([
      {
        address: CCTP.evmUsdc,
        abi: expect.any(Array),
        functionName: "approve",
        args: [CCTP.messenger, 10000000n],
      },
    ]);
    expect(s.prepared).not.toHaveBeenCalled();
    expect(s.sign).not.toHaveBeenCalled();
  });
  it("binds the Circle message to the owner recipient and prepares transaction details before burn", async () => {
    const s = setup();
    s.write.mockImplementation(async () => {
      expect(s.prepared).toHaveBeenCalled();
      return hash;
    });
    await s.run();
    const call = s.write.mock.calls[0][0] as any;
    expect(call.functionName).toBe("depositForBurnWithHook");
    expect(call.address).toBe(CCTP.messenger);
    expect(call.args[1]).toBe(3);
    expect(call.args[2].toLowerCase()).toBe(
      `0x${"0".repeat(24)}${owner.slice(2)}`,
    );
    expect(call.args[5]).toBe(100000n);
    expect(s.prepared).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "arbitrum",
        owner,
        recipient: owner,
        amount: "10000000",
        maxFee: "100000",
      }),
    );
    expect(s.sign).not.toHaveBeenCalled();
  });
  it("rejects increased fees before requesting approval or burning", async () => {
    mocks.circle.mockResolvedValue([
      {
        finalityThreshold: 2000,
        minimumFee: 0,
        forwardFee: { high: "100001" },
      },
    ]);
    const s = setup(0n);
    await expect(s.run()).rejects.toMatchObject({ code: "FEE_CHANGED" });
    expect(s.write).not.toHaveBeenCalled();
  });
  it("rejects insufficient balances before requesting a signature", async () => {
    const s = setup(0n, 9000000n);
    await expect(s.run()).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    expect(s.write).not.toHaveBeenCalled();
  });
  it.each([0n, 10000000n])(
    "supports testnet approval and burn with allowance %s",
    async (allowance) => {
      const s = setup(allowance);
      const testnet = resolveConfig({ ...config, network: "testnet" });
      await withdrawFundArbitrum(
        s.port,
        testnet,
        owner,
        10000000n,
        100000n,
        s.prepared,
      );
      expect(mocks.circle).toHaveBeenLastCalledWith(
        undefined,
        "arbitrum",
        "testnet",
      );
      expect(s.port.read).toHaveBeenCalledWith(
        expect.objectContaining({
          address: CCTP_TESTNET.evmUsdc,
          functionName: "balanceOf",
        }),
      );
      const call = s.write.mock.calls[0][0];
      if (!allowance) {
        expect(call).toMatchObject({
          address: CCTP_TESTNET.evmUsdc,
          functionName: "approve",
          args: [CCTP_TESTNET.messenger, 10000000n],
        });
      } else {
        expect(call.address).toBe(CCTP_TESTNET.messenger);
        expect(call.args?.[1]).toBe(3);
        expect(call.args?.[3]).toBe(CCTP_TESTNET.evmUsdc);
        expect(s.prepared).toHaveBeenCalledWith(
          expect.objectContaining({ network: "testnet" }),
        );
      }
      expect(s.sign).not.toHaveBeenCalled();
    },
  );
});
