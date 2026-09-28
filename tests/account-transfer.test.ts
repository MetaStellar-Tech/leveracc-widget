import { beforeEach, describe, expect, it, vi } from "vitest";
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
    coreSpotBalance: async () => 0n,
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
        previewWithdrawPlanPrimaryDirect: { netPayoutAmount: 20000000n },
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
