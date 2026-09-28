import { describe, it, expect, vi } from "vitest";
import { quoteWithdrawal, withdraw } from "../src/protocol/withdraw";
import type { AccountState } from "../src/protocol/account";
import type { ProtocolPort } from "../src/protocol/port";
import { resolveConfig } from "../src/core/config";
const owner = "0x1111111111111111111111111111111111111111";
const account = "0x2222222222222222222222222222222222222222";
const config = resolveConfig({
  projectId: `0x${"ab".repeat(32)}`,
  network: "testnet",
});
const state = {
  account,
  projectId: config.projectId,
  nonce: 3n,
  balances: { evm: 10000000n, spot: 5000000n },
} as unknown as AccountState;
function setup(net = 9000000n, safe = 20000000n) {
  const sign = vi.fn(async () => "0xab" as const),
    write = vi.fn(async () => "0xab" as const);
  const port: ProtocolPort = {
    read: async <T>(call: {
      functionName: string;
      args?: readonly unknown[];
    }) =>
      (call.functionName === "previewSafeUserClaimablePrimaryDirect"
        ? safe
        : {
            requestedAmount: call.args![1],
            netPayoutAmount: net,
            mandatoryDebtReturn: 500000n,
            pnlFeeAmount: 300000n,
            gasChargeSettledAmount: 200000n,
          }) as T,
    sign,
    write,
    coreSpotBalance: async () => 0n,
    nativeBalance: async () => 0n,
    sendCore: async () => {},
  };
  return { port, sign, write };
}
describe("withdrawal quotes and intents", () => {
  it("caps MAX by safe claimable and executable balance with Core dust", async () => {
    expect((await quoteWithdrawal(setup().port, state)).maximum).toBe(
      14995000n,
    );
    expect(
      (await quoteWithdrawal(setup(1n, 7000000n).port, state)).maximum,
    ).toBe(7000000n);
  });
  it("rejects restricted amounts before any signature", async () => {
    const { port, sign } = setup();
    await expect(quoteWithdrawal(port, state, 14995001n)).rejects.toMatchObject(
      { code: "WITHDRAW_RESTRICTED" },
    );
    expect(sign).not.toHaveBeenCalled();
  });
  it("binds owner, nonce and reviewed net payout including protocol fees", async () => {
    const { port, sign, write } = setup();
    await withdraw(port, config, owner, state, 10000000n, 9000000n);
    expect(sign.mock.calls[0]).toBeDefined();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "withdraw",
        args: [
          expect.objectContaining({
            withdrawRecipient: owner,
            requestedAmount: 10000000n,
            minPayoutAmount: 9000000n,
            nonce: 4n,
          }),
          "0xab",
        ],
      }),
    );
  });
  it("rejects worse proceeds and a missing EVM top-up before signing", async () => {
    const { port, sign } = setup();
    await expect(
      withdraw(port, config, owner, state, 10000000n, 9500000n),
    ).rejects.toMatchObject({ code: "WITHDRAW_QUOTE_CHANGED" });
    await expect(
      withdraw(port, config, owner, state, 12000000n, 9000000n),
    ).rejects.toMatchObject({ code: "EVM_BALANCE_REQUIRED" });
    expect(sign).not.toHaveBeenCalled();
  });
  it("does not submit when the wallet rejects signing", async () => {
    const { port, sign, write } = setup();
    sign.mockRejectedValueOnce({ code: 4001 });
    await expect(
      withdraw(port, config, owner, state, 10000000n, 9000000n),
    ).rejects.toMatchObject({ code: 4001 });
    expect(write).not.toHaveBeenCalled();
  });
  it("preserves quote read errors rather than returning zero withdrawable", async () => {
    const { port } = setup();
    port.read = async () => {
      throw Error("RPC unavailable");
    };
    await expect(quoteWithdrawal(port, state)).rejects.toThrow(
      "RPC unavailable",
    );
  });
});
