import { describe, expect, it, vi } from "vitest";
import {
  readArbitrumTradeBalance,
  arbitrumWithdrawalTopup,
} from "../src/protocol/arbitrum-balance";
import type { ProtocolPort } from "../src/protocol/port";
import { CCTP } from "../src/bridge/cctp";
const account = `0x${"22".repeat(20)}` as const;
function port(
  evm: bigint,
  core: bigint,
  interest: bigint | undefined,
  safe: bigint,
) {
  return {
    coreSpotBalance: vi.fn().mockResolvedValue(core),
    read: vi.fn(async ({ functionName }) =>
      functionName === "getAccountRuntimeStatus"
        ? { availableAssetBalance: evm, payableInterestNow: interest }
        : safe,
    ),
  } as unknown as ProtocolPort;
}
describe("Arbitrum trade withdrawable balance", () => {
  it.each([
    [0n, 25000000n, 1000000n, 24000000n, 23995000n],
    [25000000n, 0n, 1000000n, 24000000n, 24000000n],
    [10000000n, 15000000n, 1000000n, 5000000n, 5000000n],
    [0n, 25000000n, 0n, 25000000n, 24995000n],
    [0n, 5000n, 1n, 4999n, 0n],
    [100n, 0n, 101n, 0n, 0n],
  ])(
    "matches dapp for EVM %s / Core %s / interest %s",
    async (evm, core, interest, safe, maximum) => {
      const p = port(evm, core, interest, safe);
      const balance = await readArbitrumTradeBalance(p, account, CCTP.evmUsdc);
      expect(balance.maximum).toBe(maximum);
      expect(p.coreSpotBalance).toHaveBeenCalledWith(account);
      if (maximum) {
        const topup = arbitrumWithdrawalTopup(balance, maximum);
        expect(evm + topup - maximum).toBeGreaterThanOrEqual(interest);
        expect(topup).toBeLessThanOrEqual(core > 5000n ? core - 5000n : 0n);
      }
      expect(() => arbitrumWithdrawalTopup(balance, maximum + 1n)).toThrow();
    },
  );
  it("fails closed on unavailable interest, Core or contract reads", async () => {
    await expect(
      readArbitrumTradeBalance(
        port(25000000n, 0n, undefined, 25000000n),
        account,
        CCTP.evmUsdc,
      ),
    ).rejects.toThrow("interest");
    const p = port(25000000n, 0n, 0n, 25000000n);
    vi.mocked(p.coreSpotBalance).mockRejectedValueOnce(
      new Error("Core offline"),
    );
    await expect(
      readArbitrumTradeBalance(p, account, CCTP.evmUsdc),
    ).rejects.toThrow("Core offline");
    vi.mocked(p.read).mockRejectedValueOnce(new Error("RPC offline"));
    await expect(
      readArbitrumTradeBalance(p, account, CCTP.evmUsdc),
    ).rejects.toThrow("RPC offline");
  });
  it("rejects unsupported assets", async () => {
    await expect(
      readArbitrumTradeBalance(port(1n, 0n, 0n, 1n), account, account),
    ).rejects.toThrow("Unsupported");
  });
});
