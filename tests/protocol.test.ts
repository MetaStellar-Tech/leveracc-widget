import { describe, it, expect, vi } from "vitest";
import { zeroAddress, hashTypedData, type Address, type Hex } from "viem";
import {
  createAccount,
  bindProject,
  readAccount,
  readiness,
  type AccountState,
} from "../src/protocol/account";
import { borrow, repay, deposit, transfer } from "../src/protocol/funds";
import { resolveConfig } from "../src/core/config";
import type { ProtocolPort, ContractCall } from "../src/protocol/port";
const owner = "0x1111111111111111111111111111111111111111",
  account = "0x2222222222222222222222222222222222222222",
  execution = "0x3333333333333333333333333333333333333333",
  asset = "0x4444444444444444444444444444444444444444";
const config = resolveConfig({
  projectId: `0x${"ab".repeat(32)}`,
  network: "testnet",
});
const sig = `0x${"aa".repeat(65)}` as Hex;
function state(): AccountState {
  return {
    account,
    minimumBorrow: 1000000n,
    projectId: config.projectId,
    bindingEpoch: 1n,
    nonce: 3n,
    runtime: {
      accountState: 1,
      pendingGasChargeDebtUsdc: 0n,
      availableAssetBalance: 100000000n,
      availableUserAssetBalance: 100000000n,
      totalRealtimeDebtNow: 10000000n,
      stopRequestedAt: 0n,
    },
    capacity: {
      finalAdditionalBorrowAllowed: 50000000n,
      blockerCode: 0,
      borrowPaused: false,
      coreUserActivated: true,
    },
    execution,
    risk: execution,
    executionMode: 2,
    executionProject: config.projectId,
    registry: asset,
    asset,
    balances: {
      fund: 200000000n,
      evm: 100000000n,
      spot: 50000000n,
      perps: 30000000n,
      debt: 10000000n,
      borrowable: 50000000n,
    },
  };
}
function port(overrides: Record<string, unknown> = {}): ProtocolPort & {
  write: ReturnType<typeof vi.fn>;
  sign: ReturnType<typeof vi.fn>;
} {
  const values: Record<string, unknown> = {
    primaryAccountOf: account,
    createAccountNonce: `0x${"00".repeat(32)}`,
    user: owner,
    factory: config.factory,
    projectId: config.projectId,
    projectBindingEpoch: 1n,
    userIntentNonce: 3n,
    getAccountRuntimeStatus: state().runtime,
    previewBorrowCapacity: state().capacity,
    executionApiWallet: execution,
    riskApiWallet: execution,
    executionWalletMode: 2,
    executionWalletAuthorizedProjectId: config.projectId,
    registry: asset,
    asset,
    l1ReadAdapter: asset,
    readCoreSpotBalanceState: { total: 5000000000n, hold: 100000000n },
    readCoreUserState: { withdrawable: 30000000n },
    balanceOf: 200000000n,
    effectiveBorrowRiskConfig: [1000000n, 100000000n],
    economicConfig: asset,
    getCurrentBorrowRate: { version: 7n },
    previewRepay: { repayableAmount: 10000000n },
    previewWithdrawPlanPrimaryDirect: { netPayoutAmount: 10000000n },
    activeBorrowLotCount: 0n,
    ...overrides,
  };
  return {
    read: async <T>(call: ContractCall) => {
      const value = values[call.functionName];
      if (value instanceof Error) throw value;
      return (typeof value === "function" ? value(call) : value) as T;
    },
    sign: vi.fn(async () => sig),
    write: vi.fn(async () => `0x${"12".repeat(32)}` as Hex),
    coreSpotBalance: async () => 0n,
    nativeBalance: async () => 1000000000000000000n,
    sendCore: vi.fn(async () => {}),
  };
}
describe("account lifecycle", () => {
  it("uses reference collateral breakdown, Spot trading balance and independent risk metrics", async () => {
    const ready = await readAccount(
      port({
        previewWithdrawablePrimaryDirect: {
          userNetEquityNow: 40000000n,
          accountNetValueNow: 50000000n,
        },
        readCoreUserState: {
          withdrawable: 20000000n,
          accountValue: 30000000n,
          marginUsed: 10000000n,
        },
      }),
      config,
      owner,
      account,
    );
    expect(ready.overview).toEqual({
      collateral: 240000000n,
      collateralBreakdown: { evm: 200000000n, core: 40000000n },
      tradingAvailable: 49000000n,
      riskBps: 2000n,
    });
    const unavailable = await readAccount(
      port({ previewWithdrawablePrimaryDirect: Error("summary unavailable") }),
      config,
      owner,
      account,
    );
    expect(unavailable.account).toBe(account);
    expect(unavailable.overview?.collateral).toBe(240000000n);
    expect(unavailable.overview?.riskBps).toBeUndefined();
  });

  it.each([
    [5000000099n, 100000000n, 49000000n],
    [5000000000n, 5000000000n, 0n],
    [0n, 0n, 0n],
    [100000000n, 200000000n, 0n],
  ])(
    "uses Spot available USDC without Perps fallback (%s total, %s held)",
    async (total, hold, expected) => {
      const result = await readAccount(
        port({
          readCoreSpotBalanceState: { total, hold },
          readCoreUserState: {
            withdrawable: 30000000n,
            accountValue: 50000000n,
            marginUsed: 10000000n,
          },
        }),
        config,
        owner,
        account,
      );
      expect(result.overview?.tradingAvailable).toBe(expected);
    },
  );

  it.each([
    [5000000099n, 30000000n, 40000000n],
    [0n, 30000000n, 20000000n],
    [0n, 5000000n, 0n],
    [0n, undefined, undefined],
  ])(
    "collateral respects spot preference, precision, debt floor and missing Core data (%s)",
    async (total, accountValue, core) => {
      const result = await readAccount(
        port({
          readCoreSpotBalanceState: { total, hold: 100000000n },
          readCoreUserState: { withdrawable: 0n, accountValue },
        }),
        config,
        owner,
        account,
      );
      expect(result.overview?.collateralBreakdown).toEqual({
        evm: 200000000n,
        core,
      });
      expect(result.overview?.collateral).toBe(
        core === undefined ? undefined : 200000000n + core,
      );
      expect(result.balances.spot).toBe(
        total > 100000000n ? (total - 100000000n) / 100n : 0n,
      );
    },
  );

  it("does not substitute withdrawable funds when the collateral token read fails", async () => {
    const p = port();
    const read = p.read;
    p.read = async (request) => {
      if (request.functionName === "balanceOf" && request.args?.[0] === account)
        throw new Error("token read failed");
      return read(request);
    };
    const result = await readAccount(p, config, owner, account);
    expect(result.overview?.collateral).toBeUndefined();
    expect(result.overview?.collateralBreakdown).toEqual({
      evm: undefined,
      core: 40000000n,
    });
    expect(result.balances.evm).toBe(state().runtime.availableAssetBalance);
  });

  it("submits creation with the supplied project without reading its result", async () => {
    let reads = 0;
    const p = port({
      primaryAccountOf: () => (++reads === 1 ? zeroAddress : account),
    });
    expect(await createAccount(p, config, owner)).toBeUndefined();
    expect(reads).toBe(1);
    expect(p.write.mock.calls[0][0].functionName).toBe("createAccount");
    const data = p.sign.mock.calls[0][0];
    expect(data.message.projectId).toBe(config.projectId);
    expect(hashTypedData(data)).toMatch(/^0x[\da-f]{64}$/);
  });
  it("does not duplicate an existing account", async () => {
    const p = port();
    await createAccount(p, config, owner);
    expect(p.write).not.toHaveBeenCalled();
  });
  it("propagates factory read errors without creating", async () => {
    const p = port({ primaryAccountOf: Error("RPC offline") });
    await expect(createAccount(p, config, owner)).rejects.toThrow(
      "RPC offline",
    );
    expect(p.write).not.toHaveBeenCalled();
  });
  it("rejects wrong account owner", async () => {
    await expect(
      readAccount(port({ user: execution }), config, owner, account),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  });
  it("hands missing authorization to the host", async () => {
    const s = state();
    s.execution = zeroAddress;
    s.risk = zeroAddress;
    const reasons = readiness(s, config);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "EXECUTION_AUTHORIZATION_REQUIRED",
        "RISK_WALLET_REQUIRED",
      ]),
    );
  });
  it("accepts refreshed host authorization", async () =>
    expect(readiness(state(), config)).toEqual([]));
  it("does not switch projects with outstanding debt", async () => {
    const p = port();
    await expect(bindProject(p, config, owner, state())).rejects.toMatchObject({
      code: "PROJECT_SWITCH_BLOCKED",
    });
    expect(p.sign).not.toHaveBeenCalled();
  });
  it("switches with the next binding epoch and rechecks it", async () => {
    const s = state();
    s.runtime.totalRealtimeDebtNow = 0n;
    s.projectId = `0x${"cd".repeat(32)}`;
    const p = port({ projectBindingEpoch: 2n });
    await bindProject(p, config, owner, s);
    expect(p.sign.mock.calls[0][0].message).toMatchObject({
      fromProjectId: s.projectId,
      toProjectId: config.projectId,
      nonce: 4n,
      nextProjectBindingEpoch: 2n,
    });
  });
});
describe("lending and transfers", () => {
  it("signs exact borrow bounds, current pricing version and next nonce", async () => {
    const p = port();
    await borrow(p, config, owner, state(), 10000000n, []);
    expect(p.sign.mock.calls[0][0].message).toMatchObject({
      minBorrowAmount: 10000000n,
      maxBorrowAmount: 10000000n,
      expectedBorrowRateVersion: 7n,
      nonce: 4n,
      projectId: config.projectId,
    });
    expect(p.write.mock.calls[0][0].functionName).toBe("borrow");
  });
  it("does not sign or send before host authorization", async () => {
    const p = port();
    await expect(
      borrow(p, config, owner, state(), 10000000n, [
        "EXECUTION_AUTHORIZATION_REQUIRED",
      ]),
    ).rejects.toMatchObject({ code: "ACCOUNT_ACTION_REQUIRED" });
    expect(p.sign).not.toHaveBeenCalled();
    expect(p.write).not.toHaveBeenCalled();
  });
  it.each(["paused", "capacity"])("blocks borrowing for %s", async (why) => {
    const p = port(),
      s = state();
    if (why === "paused") s.capacity.borrowPaused = true;
    else s.capacity.finalAdditionalBorrowAllowed = 1n;
    await expect(borrow(p, config, owner, s, 10000000n, [])).rejects.toThrow();
    expect(p.sign).not.toHaveBeenCalled();
  });
  it("uses exact partial repayment without a hidden amount increase", async () => {
    const p = port();
    await repay(p, config, owner, state(), 5000000n, false);
    expect(p.sign.mock.calls[0][0].message.requestedRepayAmount).toBe(5000000n);
  });
  it("includes an explicit full-repay buffer", async () => {
    const p = port();
    await repay(p, config, owner, state(), 10000000n, true);
    expect(p.sign.mock.calls[0][0].message.requestedRepayAmount).toBe(
      10010000n,
    );
  });
  it("requires an explicit Core-to-EVM transfer before underfunded repayment", async () => {
    const s = state();
    s.balances.evm = 0n;
    const p = port();
    await expect(
      repay(p, config, owner, s, 10000000n, false),
    ).rejects.toMatchObject({ code: "EVM_BALANCE_REQUIRED" });
    expect(p.write).not.toHaveBeenCalled();
  });
  it("deposits only into the resolved LAAccount", async () => {
    const p = port();
    await deposit(p, owner, state(), 1000000n);
    expect(p.write.mock.calls[0][0]).toMatchObject({
      address: asset,
      functionName: "transfer",
      args: [account, 1000000n],
    });
  });
  it.each([
    ["evmToCore", "moveEvmUsdcToCoreForSelf", [1000000n]],
    ["coreToEvm", "sendCoreSpotToEvm", [0n, 1000000n]],
    ["spotToPerps", "sendCoreUsdClassTransfer", [1000000n, true]],
    ["perpsToSpot", "sendCoreUsdClassTransfer", [1000000n, false]],
  ] as const)("routes %s with USDC6", async (route, fn, args) => {
    const p = port();
    await transfer(p, config, owner, state(), route, 1000000n);
    expect(p.write.mock.calls[0][0]).toMatchObject({ functionName: fn, args });
  });
  it("leaves Core dust in place", async () => {
    const p = port();
    await expect(
      transfer(p, config, owner, state(), "coreToEvm", 50000000n),
    ).rejects.toThrow();
    expect(p.write).not.toHaveBeenCalled();
  });
});
