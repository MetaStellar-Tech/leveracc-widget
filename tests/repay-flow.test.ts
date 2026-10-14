import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRepayment, repayAvailable } from "../src/protocol/repay-flow";
import { resolveConfig } from "../src/core/config";
import type { AccountState } from "../src/protocol/account";
import type { ProtocolPort } from "../src/protocol/port";
import type { OperationRecord } from "../src/types";

const owner = `0x${"11".repeat(20)}` as const;
const account = `0x${"22".repeat(20)}` as const;
const hash = `0x${"33".repeat(32)}` as const;
const config = resolveConfig({ projectId: hash, network: "testnet" });
function fixture(evm = 127652n, spot = 59273703n) {
  let balance = evm,
    debt = 42558294n,
    nonce = 3n;
  const state = () =>
    ({
      account,
      projectId: hash,
      bindingEpoch: 1n,
      nonce,
      registry: owner,
      asset: owner,
      runtime: { availableAssetBalance: balance, totalRealtimeDebtNow: debt },
      balances: { evm: balance, spot, debt },
    }) as AccountState;
  const op = { action: "repay", stage: "preparing" } as OperationRecord;
  const progress = (stage: OperationRecord["stage"]) => {
    op.stage = stage;
  };
  const p: ProtocolPort = {
    read: vi.fn(async (call) => {
      const values: Record<string, unknown> = {
        user: owner,
        factory: config.factory,
        projectId: hash,
        projectBindingEpoch: 1n,
        userIntentNonce: nonce,
        registry: owner,
        asset: owner,
        getAccountRuntimeStatus: state().runtime,
        previewBorrowCapacity: { finalAdditionalBorrowAllowed: 0n },
        previewWithdrawablePrimaryDirect: {},
        effectiveBorrowRiskConfig: [0n, 0n],
        l1ReadAdapter: owner,
        readCoreSpotBalanceState: { total: spot * 100n, hold: 0n },
        readCoreUserState: { withdrawable: 0n },
        balanceOf: 0n,
      };
      if (call.functionName === "previewRepay") {
        const requested = call.args![0] as bigint;
        return { repayableAmount: requested < debt ? requested : debt } as any;
      }
      return values[call.functionName] as any;
    }),
    coreSpotBalance: async () => spot,
    nativeBalance: async () => 0n,
    sendCore: vi.fn(),
    sign: vi.fn(async () => {
      progress("signing");
      return hash;
    }),
    write: vi.fn(async () => {
      progress("submitting");
      progress("submitted");
      return hash;
    }),
    waitForReceipt: vi.fn(async () => {
      balance = debt;
      nonce = 9n;
      return "success" as const;
    }),
    pause: vi.fn(async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
    }),
    checkContext: vi.fn(async () => {}),
  };
  return {
    p,
    op,
    state,
    run: (amount = 42558294n, full = false) =>
      executeRepayment(p, config, owner, state(), op, amount, full, progress),
    setBalance: (n: bigint) => {
      balance = n;
    },
    setDebt: (n: bigint) => {
      debt = n;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("automatic repayment", () => {
  it("tops up exactly the reported shortfall and uses the refreshed nonce", async () => {
    const f = fixture();
    await f.run();
    expect(f.p.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "sendCoreSpotToEvm",
        args: [0n, 42430642n],
      }),
    );
    expect(f.p.waitForReceipt).toHaveBeenCalledWith(hash);
    expect(f.p.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          requestedRepayAmount: 42558294n,
          nonce: 10n,
        }),
      }),
    );
    expect(f.p.write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ functionName: "repay" }),
    );
  });
  it("skips top-up when EVM covers the repayment", async () => {
    const f = fixture(50000000n);
    await f.run();
    expect(f.p.waitForReceipt).toHaveBeenCalledTimes(1);
    expect(f.p.write).toHaveBeenCalledTimes(1);
  });
  it("rejects insufficient Core before requesting any wallet action", async () => {
    const f = fixture(0n, 42558294n);
    await expect(f.run()).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    expect(f.p.write).not.toHaveBeenCalled();
    expect(f.p.sign).not.toHaveBeenCalled();
    expect(repayAvailable(127652n, 5000n, 42558294n)).toBe(127652n);
  });
  it("waits for arrival and resumes after timeout without another transfer", async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.mocked(f.p.waitForReceipt!).mockResolvedValue("success");
    const result = expect(f.run()).rejects.toMatchObject({
      code: "REPAY_ARRIVAL_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(90000);
    await result;
    expect(f.p.sign).not.toHaveBeenCalled();
    f.setBalance(42558294n);
    await f.run();
    expect(f.p.write).toHaveBeenCalledTimes(2);
    expect(f.p.waitForReceipt).toHaveBeenCalledTimes(2);
  });
  it("rechecks the same receipt after confirmation errors", async () => {
    const f = fixture();
    vi.mocked(f.p.waitForReceipt!).mockRejectedValueOnce(
      Error("confirmation timeout"),
    );
    await expect(f.run()).rejects.toThrow("confirmation timeout");
    expect(f.p.sign).not.toHaveBeenCalled();
    await f.run();
    expect(f.p.waitForReceipt).toHaveBeenNthCalledWith(2, hash);
    expect(f.p.write).toHaveBeenCalledTimes(2);
  });
  it("allows a fresh top-up after an explicit revert", async () => {
    const f = fixture();
    vi.mocked(f.p.waitForReceipt!).mockResolvedValueOnce("reverted");
    await expect(f.run()).rejects.toMatchObject({
      code: "REPAY_TOPUP_REVERTED",
    });
    expect(f.op.repayFlow?.topupHash).toBeUndefined();
    await f.run();
    expect(f.p.write).toHaveBeenCalledTimes(3);
  });
  it("preserves the amount through rejected signatures and debt growth", async () => {
    const f = fixture();
    vi.mocked(f.p.sign).mockRejectedValueOnce({ code: 4001 });
    await expect(f.run()).rejects.toMatchObject({ code: 4001 });
    f.setDebt(43000000n);
    await f.run();
    expect(f.p.write).toHaveBeenCalledTimes(2);
    expect(f.p.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ requestedRepayAmount: 42558294n }),
      }),
    );
  });
  it("does not sign after a context change", async () => {
    const f = fixture();
    vi.mocked(f.p.checkContext!).mockRejectedValue(Error("context changed"));
    await expect(f.run()).rejects.toThrow("context changed");
    expect(f.p.sign).not.toHaveBeenCalled();
  });
  it.each([0n, 1n])("rejects zero or smaller live debt (%s)", async (debt) => {
    const f = fixture();
    f.setDebt(debt);
    await expect(f.run()).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(f.p.write).not.toHaveBeenCalled();
  });
  it("does not repeat an ambiguous submission", async () => {
    const f = fixture();
    vi.mocked(f.p.write).mockImplementationOnce(async () => {
      f.op.stage = "submitting";
      throw Error("transport lost");
    });
    await expect(f.run()).rejects.toThrow("transport lost");
    await expect(f.run()).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
    expect(f.p.write).toHaveBeenCalledTimes(1);
  });
  it("retains the transfer through arrival read failures", async () => {
    const f = fixture();
    const read = f.p.read;
    let fail = true;
    f.p.read = async (call) => {
      if (call.functionName === "getAccountRuntimeStatus" && fail) {
        fail = false;
        throw Error("RPC offline");
      }
      return read(call);
    };
    await expect(f.run()).rejects.toThrow("RPC offline");
    expect(f.op.repayFlow?.step).toBe("arrival");
    await f.run();
    expect(f.p.waitForReceipt).toHaveBeenCalledTimes(2);
    expect(f.p.write).toHaveBeenCalledTimes(2);
  });
  it("checks reduced debt without increasing the fixed request", async () => {
    const f = fixture();
    vi.mocked(f.p.sign).mockRejectedValueOnce({ code: 4001 });
    await expect(f.run()).rejects.toMatchObject({ code: 4001 });
    f.setDebt(20000000n);
    await f.run();
    expect(f.p.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ requestedRepayAmount: 42558294n }),
      }),
    );
    expect(f.p.write).toHaveBeenCalledTimes(2);
  });
  it("matches dapp partial repayment preview including 0.1% allowance", async () => {
    const f = fixture(50000000n);
    await f.run(10000000n);
    expect(f.p.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ requestedRepayAmount: 10010000n }),
      }),
    );
    expect(f.op.stage).toBe("success");
  });
  it("rechecks a final repayment receipt without sending or signing again", async () => {
    const f = fixture(50000000n);
    vi.mocked(f.p.waitForReceipt!).mockRejectedValueOnce(
      Error("final confirmation timeout"),
    );
    await expect(f.run()).rejects.toThrow("final confirmation timeout");
    expect(f.op.repayFlow?.step).toBe("repayConfirming");
    await f.run();
    expect(f.p.write).toHaveBeenCalledTimes(1);
    expect(f.p.sign).toHaveBeenCalledTimes(1);
    expect(f.op.stage).toBe("success");
  });
  it("retries an explicitly reverted repayment with a fresh signature", async () => {
    const f = fixture(50000000n);
    vi.mocked(f.p.waitForReceipt!).mockResolvedValueOnce("reverted");
    await expect(f.run()).rejects.toMatchObject({ code: "REPAY_REVERTED" });
    await f.run();
    expect(f.p.sign).toHaveBeenCalledTimes(2);
    expect(f.op.stage).toBe("success");
  });
  it("funds and signs the full allowance even when preview caps payment at current debt", async () => {
    const f = fixture();
    vi.mocked(f.p.waitForReceipt!).mockImplementation(async () => {
      f.setBalance(42600853n);
      f.setDebt(42580000n); // Interest accrued while moving funds from Core.
      return "success";
    });
    await f.run(42558294n, true);
    expect(f.p.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "sendCoreSpotToEvm",
        args: [0n, 42473201n],
      }),
    );
    expect(f.p.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ requestedRepayAmount: 42600853n }),
      }),
    );
    expect(f.op.repayFlow).toMatchObject({
      full: true,
      amount: "42600853",
      step: "complete",
    });
  });
  it("retains the full allowance on signature retry without a second top-up", async () => {
    const f = fixture();
    vi.mocked(f.p.waitForReceipt!).mockImplementation(async () => {
      f.setBalance(42600853n);
      return "success";
    });
    vi.mocked(f.p.sign).mockRejectedValueOnce({ code: 4001 });
    await expect(f.run(42558294n, true)).rejects.toMatchObject({ code: 4001 });
    f.setDebt(42590000n);
    await f.run();
    expect(f.p.write).toHaveBeenCalledTimes(2);
    expect(f.p.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ requestedRepayAmount: 42600853n }),
      }),
    );
  });
  it("requires funds for the full allowance, not merely the initial preview debt", async () => {
    const f = fixture(42558294n, 5000n);
    await expect(f.run(42558294n, true)).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    expect(f.p.write).not.toHaveBeenCalled();
    expect(f.p.sign).not.toHaveBeenCalled();
  });
});
