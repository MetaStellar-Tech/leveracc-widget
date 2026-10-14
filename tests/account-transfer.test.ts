import { submitAccountTransfer } from "../src/protocol/account-transfer-submission";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { resolveConfig } from "../src/core/config";
import {
  prepareAccountTransfer,
  executeAccountTransfer,
  advanceAccountTransfer,
  withdrawalPlan,
} from "../src/protocol/account-transfer";
import type { ProtocolPort, ContractCall } from "../src/protocol/port";
import type { AccountState } from "../src/protocol/account";
import type { OperationRecord } from "../src/types";
const owner = "0x1111111111111111111111111111111111111111",
  account = "0x2222222222222222222222222222222222222222",
  asset = "0x3333333333333333333333333333333333333333";
const config = resolveConfig({
  projectId: `0x${"ab".repeat(32)}`,
  network: "testnet",
});
const hash = `0x${"ef".repeat(32)}` as Hex;
let targetExists: boolean,
  ownerExists: boolean,
  allowance: bigint,
  ownerCore: bigint,
  targetCore: bigint,
  evm: bigint;
function state(): AccountState {
  return {
    account,
    projectId: config.projectId,
    bindingEpoch: 1n,
    nonce: 1n,
    execution: asset,
    risk: asset,
    executionMode: 2,
    executionProject: config.projectId,
    registry: asset,
    asset,
    minimumBorrow: 1n,
    runtime: {
      accountState: 1,
      pendingGasChargeDebtUsdc: 0n,
      availableAssetBalance: evm,
      availableUserAssetBalance: evm,
      totalRealtimeDebtNow: 0n,
      payableInterestNow: 0n,
      stopRequestedAt: 0n,
    },
    capacity: {
      finalAdditionalBorrowAllowed: 10n,
      blockerCode: 0,
      borrowPaused: false,
      coreUserActivated: targetExists,
    },
    balances: {
      fund: 100000000n,
      evm,
      spot: targetCore,
      perps: 0n,
      debt: 0n,
      borrowable: 10n,
    },
  };
}
function port(): ProtocolPort & {
  write: ReturnType<typeof vi.fn>;
  sendCore: ReturnType<typeof vi.fn>;
} {
  return {
    coreSpotBalance: async (address) =>
      address === owner ? ownerCore : targetCore,
    nativeBalance: async () => 1000000000000000000n,
    sign: async () => hash,
    write: vi.fn(async () => hash),
    sendCore: vi.fn(async () => {}),
    read: async <T>(call: ContractCall) => {
      const values: Record<string, unknown> = {
        user: owner,
        factory: config.factory,
        projectId: config.projectId,
        projectBindingEpoch: 1n,
        userIntentNonce: 1n,
        getAccountRuntimeStatus: state().runtime,
        previewBorrowCapacity: state().capacity,
        executionApiWallet: asset,
        riskApiWallet: asset,
        executionWalletMode: 2,
        executionWalletAuthorizedProjectId: config.projectId,
        registry: asset,
        asset,
        l1ReadAdapter: asset,
        effectiveBorrowRiskConfig: [1n, 100000000n],
        balanceOf: 100000000n,
        readCoreUserState: { withdrawable: 0n },
        previewSafeUserClaimablePrimaryDirect: 100000000n,
        previewWithdrawPlanPrimaryDirect: {
          requestedAmount: 20000000n,
          netPayoutAmount: 20000000n,
        },
      };
      if (call.functionName === "allowance") return allowance as T;
      if (call.functionName === "readCoreUserExists")
        return (call.args?.[0] === owner ? ownerExists : targetExists) as T;
      if (call.functionName === "readCoreSpotBalanceState")
        return {
          total: (call.args?.[0] === owner ? ownerCore : targetCore) * 100n,
          hold: 0n,
        } as T;
      return values[call.functionName] as T;
    },
  };
}
function op(
  flow: NonNullable<OperationRecord["transferFlow"]>,
): OperationRecord {
  return {
    network: config.network,
    projectId: config.projectId,
    owner,
    account,
    id: "transfer",
    action: "transfer",
    stage: "settling",
    chainId: 998,
    createdAt: 1,
    hash,
    transferFlow: flow,
  };
}
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  localStorage.clear();
  targetExists = true;
  ownerExists = true;
  allowance = 0n;
  ownerCore = 2000000n;
  targetCore = 50000000n;
  evm = 10000000n;
});
describe("dapp account transfer routing", () => {
  it("approves then deposits directly to an existing Trade Core account without waiting for credit", async () => {
    const p = port(),
      flow = await prepareAccountTransfer(
        p,
        config,
        owner,
        state(),
        "fundToTrade",
        20000000n,
      ),
      record = op(flow);
    expect(flow.step).toBe("approval");
    await executeAccountTransfer(p, config, owner, state(), flow);
    expect(p.write.mock.calls[0][0]).toMatchObject({
      functionName: "approve",
      args: [config.coreDepositWallet, 20000000n],
    });
    expect(await advanceAccountTransfer(record)).toBe("awaitingAction");
    expect(record.hash).toBe(hash);
    expect(flow.completedHashes).toEqual([hash]);
    await expect(
      executeAccountTransfer(p, config, owner, state(), flow),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    allowance = 20000000n;
    await executeAccountTransfer(p, config, owner, state(), flow);
    expect(p.write.mock.calls[1][0]).toMatchObject({
      functionName: "depositFor",
      args: [account, 20000000n, 4294967295],
    });
    expect(await advanceAccountTransfer(record)).toBe("submitted");
  });
  it("relays initial activation through owner Core and accounts for activation fees", async () => {
    targetExists = false;
    allowance = 100000000n;
    const p = port(),
      flow = await prepareAccountTransfer(
        p,
        config,
        owner,
        state(),
        "fundToTrade",
        20000000n,
      ),
      record = op(flow);
    expect(flow.minimum).toBe("19000000");
    await executeAccountTransfer(p, config, owner, state(), flow);
    expect(p.write.mock.calls[0][0].args).toEqual([
      owner,
      20000000n,
      4294967295,
    ]);

    expect(await advanceAccountTransfer(record)).toBe("awaitingAction");
    expect(flow.step).toBe("relay");
    await expect(
      executeAccountTransfer(p, config, owner, state(), flow),
    ).rejects.toMatchObject({ code: "CORE_RESERVE_REQUIRED" });
    ownerCore += 20000000n;
    await executeAccountTransfer(p, config, owner, state(), flow);
    expect(p.sendCore).toHaveBeenCalledWith(account, "20");
    expect(await advanceAccountTransfer(record)).toBe("submitted");
  });
  it.each(["inactive", "reserve", "amount"])(
    "blocks unsafe activation: %s",
    async (why) => {
      targetExists = false;
      if (why === "inactive") ownerExists = false;
      if (why === "reserve") ownerCore = 1000000n;
      await expect(
        prepareAccountTransfer(
          port(),
          config,
          owner,
          state(),
          "fundToTrade",
          why === "amount" ? 1000000n : 20000000n,
        ),
      ).rejects.toThrow();
    },
  );
  it("withdraws only the EVM shortfall from Core, then checks EVM before asking for the withdrawal signature", async () => {
    const p = port(),
      flow = await prepareAccountTransfer(
        p,
        config,
        owner,
        state(),
        "accountToFund",
        20000000n,
      ),
      record = op(flow);
    expect(flow.topup).toBe("10000000");
    await executeAccountTransfer(p, config, owner, state(), flow);
    expect(p.write.mock.calls[0][0]).toMatchObject({
      functionName: "sendCoreSpotToEvm",
      args: [0n, 10000000n],
    });

    expect(await advanceAccountTransfer(record)).toBe("awaitingAction");
    await expect(
      executeAccountTransfer(p, config, owner, state(), flow),
    ).rejects.toMatchObject({ code: "EVM_BALANCE_REQUIRED" });
    evm += 10000000n;
    await executeAccountTransfer(p, config, owner, state(), flow);
    expect(p.write.mock.calls[1][0].functionName).toBe("withdraw");
    expect(await advanceAccountTransfer(record)).toBe("submitted");
  });
  it("uses EVM directly when sufficient and reserves Core dust in MAX", async () => {
    evm = 30000000n;
    expect(
      (
        await prepareAccountTransfer(
          port(),
          config,
          owner,
          state(),
          "accountToFund",
          20000000n,
        )
      ).step,
    ).toBe("withdraw");
    expect(withdrawalPlan(79995001n, evm, targetCore).feasible).toBe(false);
    expect(withdrawalPlan(79995000n, evm, targetCore)).toMatchObject({
      maximum: 79995000n,
      topup: 49995000n,
      feasible: true,
    });
  });
});

describe("current dapp submission lifecycle", () => {
  async function setup(direction: "fundToTrade" | "accountToFund") {
    const p = port();
    p.checkContext = vi.fn(async () => {});
    p.pause = vi.fn(async () => {});
    p.waitForReceipt = vi.fn(async () => {
      const call = p.write.mock.calls.at(-1)![0];
      if (call.functionName === "approve") allowance = call.args[1];
      if (call.functionName === "sendCoreSpotToEvm") evm += call.args[1];
      if (call.functionName === "depositFor") ownerCore += call.args[1];
      return "success" as const;
    });
    const flow = await prepareAccountTransfer(
      p,
      config,
      owner,
      state(),
      direction,
      20000000n,
      true,
    );
    flow.submission = { phase: "ready" };
    const record = op(flow);
    const run = () =>
      submitAccountTransfer(p, config, owner, state(), record, (stage) => {
        record.stage = stage;
      });
    return { p, flow, record, run };
  }
  it("confirms approval and automatically deposits, without a final receipt", async () => {
    const f = await setup("fundToTrade");
    await f.run();
    expect(f.p.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "approve",
      "depositFor",
    ]);
    expect(f.p.waitForReceipt).toHaveBeenCalledTimes(1);
    expect(f.flow.submission?.phase).toBe("submitted");
  });
  it("waits for owner Core funding, then requires a separate relay click", async () => {
    targetExists = false;
    allowance = 20000000n;
    const f = await setup("fundToTrade");
    await f.run();
    expect(f.flow.step).toBe("relay");
    expect(f.flow.submission?.phase).toBe("ready");
    expect(f.p.sendCore).not.toHaveBeenCalled();
    await f.run();
    expect(f.p.sendCore).toHaveBeenCalledWith(account, "20");
    expect(f.p.waitForReceipt).toHaveBeenCalledTimes(1);
  });
  it("waits for Core top-up and automatically signs the withdrawal", async () => {
    const f = await setup("accountToFund");
    await f.run();
    expect(f.flow.step).toBe("withdraw");
    expect(f.p.write).toHaveBeenCalledTimes(2);
    expect(f.p.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "sendCoreSpotToEvm",
      "withdraw",
    ]);
    expect(f.p.waitForReceipt).toHaveBeenCalledTimes(1);
  });
  it.each([0n, 19000000n])(
    "blocks contract maximum %s before moving Core funds",
    async (maximum) => {
      const f = await setup("accountToFund");
      const read = f.p.read;
      f.p.read = async (call) =>
        call.functionName === "previewSafeUserClaimablePrimaryDirect"
          ? (maximum as any)
          : read(call);
      await expect(f.run()).rejects.toMatchObject({
        code: "WITHDRAW_RESTRICTED",
      });
      expect(f.p.write).not.toHaveBeenCalled();
    },
  );
  it("rechecks debt and position limits after the top-up", async () => {
    const f = await setup("accountToFund");
    const read = f.p.read;
    f.p.read = async (call) =>
      call.functionName === "previewSafeUserClaimablePrimaryDirect" &&
      evm >= 20000000n
        ? (19000000n as any)
        : read(call);
    await expect(f.run()).rejects.toMatchObject({
      code: "WITHDRAW_RESTRICTED",
    });
    expect(f.p.write).toHaveBeenCalledTimes(1);
  });
  it("reserves payable interest in the Core top-up", async () => {
    const f = await setup("accountToFund");
    const read = f.p.read;
    f.p.read = async (call) =>
      call.functionName === "getAccountRuntimeStatus"
        ? ({ ...state().runtime, payableInterestNow: 250000n } as any)
        : read(call);
    await f.run();
    expect(f.p.write.mock.calls[0][0].args).toEqual([0n, 10255000n]);
    expect(f.p.write.mock.calls[1][0].functionName).toBe("withdraw");
  });
  it("reaches WithdrawIntent signing despite interest accruing after the top-up", async () => {
    const f = await setup("accountToFund");
    let interest = 100n;
    const read = f.p.read;
    f.p.read = async (call) =>
      call.functionName === "getAccountRuntimeStatus"
        ? ({ ...state().runtime, payableInterestNow: interest } as any)
        : call.functionName === "userIntentNonce"
          ? ((interest === 110n ? 7n : 1n) as any)
          : read(call);
    const receipt = f.p.waitForReceipt!;
    f.p.waitForReceipt = async (...args) => {
      const result = await receipt(...args);
      interest = 110n;
      return result;
    };
    const sign = vi.fn(f.p.sign);
    f.p.sign = sign;
    await f.run();
    expect(f.flow.step).toBe("withdraw");
    expect(f.flow.topup).toBe("10005100");
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryType: "WithdrawIntent",
        message: expect.objectContaining({
          requestedAmount: 20000000n,
          minPayoutAmount: 20000000n,
          withdrawRecipient: owner,
          nonce: 8n,
        }),
      }),
    );
    expect(f.p.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "sendCoreSpotToEvm",
      "withdraw",
    ]);
  });
  it("does not sign or move funds if contract limits cannot be read", async () => {
    const f = await setup("accountToFund");
    const read = f.p.read;
    f.p.read = async (call) => {
      if (call.functionName === "previewSafeUserClaimablePrimaryDirect")
        throw Error("limits unavailable");
      return read(call);
    };
    await expect(f.run()).rejects.toThrow("limits unavailable");
    expect(f.p.write).not.toHaveBeenCalled();
  });
  it("checks an uncertain intermediate result then automatically withdraws without another top-up", async () => {
    const f = await setup("accountToFund");
    vi.mocked(f.p.waitForReceipt!).mockRejectedValueOnce(Error("RPC timeout"));
    await expect(f.run()).rejects.toThrow("RPC timeout");
    expect(f.flow.submission?.phase).toBe("check");
    await f.run();
    expect(f.flow.submission?.phase).toBe("submitted");
    expect(f.p.write).toHaveBeenCalledTimes(2);
  });
  it("blocks a restricted withdrawal before any Core movement", async () => {
    const f = await setup("accountToFund");
    const read = f.p.read;
    f.p.read = async (call) =>
      call.functionName === "previewWithdrawPlanPrimaryDirect"
        ? ({ requestedAmount: 20000000n, netPayoutAmount: 19000000n } as any)
        : read(call);
    await expect(f.run()).rejects.toMatchObject({
      code: "WITHDRAW_RESTRICTED",
    });
    expect(f.p.write).not.toHaveBeenCalled();
  });
  it("keeps an explicit intermediate revert retryable", async () => {
    const f = await setup("accountToFund");
    vi.mocked(f.p.waitForReceipt!).mockResolvedValueOnce("reverted");
    await expect(f.run()).rejects.toMatchObject({ code: "TRANSFER_REVERTED" });
    expect(f.flow.submission).toEqual({ phase: "ready" });
    await f.run();
    expect(f.p.write).toHaveBeenCalledTimes(3);
  });
  it("bounds stalled intermediate RPC calls and retains a check-only continuation", async () => {
    vi.useFakeTimers();
    const f = await setup("accountToFund");
    vi.mocked(f.p.waitForReceipt!).mockImplementation(
      () => new Promise(() => {}),
    );
    const result = expect(f.run()).rejects.toMatchObject({
      code: "TRANSACTION_WAIT_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(90000);
    await result;
    expect(f.flow.submission?.phase).toBe("check");
    expect(f.p.write).toHaveBeenCalledTimes(1);
  });
  it("keeps definite contract rejection retryable instead of treating it as unknown", async () => {
    const f = await setup("fundToTrade");
    const error = new Error("reverted");
    error.name = "ContractFunctionRevertedError";
    f.p.write.mockImplementationOnce(async () => {
      f.record.stage = "submitting";
      throw error;
    });
    await expect(f.run()).rejects.toThrow("reverted");
    expect(f.flow.submission?.phase).toBe("ready");
    await f.run();
    expect(f.flow.submission?.phase).toBe("submitted");
  });
});
