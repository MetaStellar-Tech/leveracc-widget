import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { zeroAddress, type Hex } from "viem";
import type { WidgetOptions, WalletProvider, WidgetEvent } from "../src/types";
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  info: vi.fn(),
  receipt: vi.fn(),
  sign: vi.fn(),
  ports: [] as unknown[],
  gas: vi.fn(),
}));
vi.mock("../src/protocol/port", () => ({
  createPort: (
    config: unknown,
    provider: unknown,
    owner: unknown,
    current: () => boolean,
    progress: (stage: string, hash?: string) => void,
    guard: () => Promise<void>,
  ) => {
    const port = {
      coreSpotBalance: async () => {
        const state = await mock.info("spotClearinghouseState");
        const usdc = state.balances.find(
          (b: { coin: string }) => b.coin === "USDC",
        );
        return (
          BigInt(Number(usdc?.total ?? 0) * 1e6) -
          BigInt(Number(usdc?.hold ?? 0) * 1e6)
        );
      },
      nativeBalance: mock.gas,
      sendCore: vi.fn(async () => {}),
      read: mock.read,
      info: mock.info,
      sign: async (data: unknown) => {
        await guard();
        if (!current()) throw Error("Context changed");
        progress("signing");
        return mock.sign(data);
      },
      write: async (call: unknown) => {
        await guard();
        if (!current()) throw Error("Context changed");
        progress("submitting");
        const hash = await mock.write(call);
        progress("submitted", hash);
        return hash;
      },
    };
    mock.ports.push(port);
    return port;
  },
  publicRpc: () => ({ getTransactionReceipt: mock.receipt }),
}));
import { WidgetController } from "../src/core/controller";
import { resolveConfig } from "../src/core/config";
import { creationKey, loadCreation } from "../src/protocol/creation-tracking";
import { operationKey } from "../src/core/operations";
function saveOperation(op: import("../src/types").OperationRecord) {
  localStorage.setItem(operationKey(op), JSON.stringify(op));
}
const owner = "0x1111111111111111111111111111111111111111",
  account = "0x2222222222222222222222222222222222222222",
  agent = "0x3333333333333333333333333333333333333333",
  asset = "0x4444444444444444444444444444444444444444",
  hash = `0x${"ef".repeat(32)}` as Hex;
const config: WidgetOptions["config"] = {
  projectId: `0x${"ab".repeat(32)}`,
  network: "testnet",
};
let registered = true,
  created = true,
  listeners: Record<string, (...args: unknown[]) => void>,
  controllers: WidgetController[];
function make(events: WidgetEvent[] = []) {
  const wallet = {
    request: vi.fn(async ({ method }: { method: string }) =>
      method === "personal_sign" ? "0x1234" : [owner],
    ),
    on: (name: string, fn: (...args: unknown[]) => void) => {
      listeners[name] = fn;
    },
    removeListener: vi.fn(),
  } as unknown as WalletProvider;
  const c = new WidgetController({
    config,
    wallet,
    onEvent: (e) => events.push(e),
  });
  controllers.push(c);
  return { c, wallet };
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  registered = true;
  created = true;
  listeners = {};
  controllers = [];
  vi.clearAllMocks();
  mock.gas.mockResolvedValue(1000000000000000000n);
  const preset = resolveConfig(config);
  mock.read.mockImplementation(
    async ({ functionName: name }: { functionName: string }) =>
      ({
        primaryAccountOf: created ? account : zeroAddress,
        user: owner,
        factory: preset.factory,
        projectId: config.projectId,
        projectBindingEpoch: 1n,
        userIntentNonce: 3n,
        executionApiWallet: registered ? agent : zeroAddress,
        riskApiWallet: agent,
        executionWalletMode: 2,
        executionWalletAuthorizedProjectId: config.projectId,
        registry: asset,
        asset,
        allowance: 0n,
        readCoreUserExists: true,
        l1ReadAdapter: asset,
        readCoreSpotBalanceState: { total: 5000000000n, hold: 0n },
        readCoreUserState: { withdrawable: 30000000n },
        balanceOf: 100000000n,
        getAccountRuntimeStatus: {
          availableAssetBalance: 100000000n,
          totalRealtimeDebtNow: 0n,
          pendingGasChargeDebtUsdc: 0n,
          stopRequestedAt: 0n,
          accountState: 1,
        },
        previewBorrowCapacity: {
          finalAdditionalBorrowAllowed: 50000000n,
          blockerCode: 0,
          coreUserActivated: true,
          borrowPaused: false,
        },
        effectiveBorrowRiskConfig: [1000000n, 100000000n],
        economicConfig: asset,
        getCurrentBorrowRate: { version: 1n },
        createAccountNonce: `0x${"00".repeat(32)}`,
      })[name],
  );
  mock.info.mockImplementation(
    async (type: string) =>
      ({
        spotClearinghouseState: {
          balances: [{ coin: "USDC", total: "50", hold: "0" }],
        },
        clearinghouseState: { withdrawable: "30" },
        extraAgents: [{ address: agent, validUntil: Date.now() + 600000 }],
        userRole: { role: "agent", data: { user: account } },
      })[type],
  );
  mock.sign.mockResolvedValue(`0x${"ab".repeat(65)}`);
  mock.write.mockResolvedValue(hash);
  mock.receipt.mockResolvedValue({ status: "success" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Unexpected HTTP API request");
    }),
  );
});
afterEach(() => {
  controllers.forEach((c) => c.destroy());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("widget lifecycle integration", () => {
  it("discovers the account, emits host handoff, and refreshes after host authorization", async () => {
    registered = false;
    const events: WidgetEvent[] = [];
    const { c } = make(events);
    await c.connect();
    expect(c.getSnapshot().status).toBe("ready");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "accountActionRequired",
        reasons: expect.arrayContaining(["EXECUTION_AUTHORIZATION_REQUIRED"]),
      }),
    );
    registered = true;
    await c.refresh();
    expect(c.getSnapshot().reasons).toEqual([]);
  });
  it("only enters loading before the first account read in a context", async () => {
    const { c } = make();
    const states: string[] = [];
    const unsubscribe = c.subscribe(() => states.push(c.getSnapshot().status));
    await c.connect();
    expect(states).toContain("loading");
    const balances = c.getSnapshot().balances;
    const read = mock.read.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.read.mockImplementation(async (...args) => {
      await gate;
      return read(...args);
    });
    states.length = 0;
    const refresh = c.refresh();
    expect(c.getSnapshot().status).toBe("ready");
    expect(c.getSnapshot().balances).toBe(balances);
    release();
    await refresh;
    expect(states).not.toContain("loading");
    expect(c.getSnapshot().status).toBe("ready");
    unsubscribe();
  });
  it("creates and rediscovers a new account", async () => {
    history([
      {
        requested_usdc_amount_raw: "3000000",
        phase: "success",
        terminal: true,
      },
    ]);
    created = false;
    const { c } = make();
    await c.connect();
    expect(c.getSnapshot().status).toBe("noAccount");
    mock.write.mockImplementation(async () => {
      created = true;
      return hash;
    });
    await c.createAccount();
    await vi.waitFor(() => expect(c.getSnapshot().account).toBe(account));
    expect(c.getSnapshot().operation?.stage).toBe("submitted");
  });
  it("emits success with its original context and no credentials", async () => {
    const events: WidgetEvent[] = [];
    const { c } = make(events);
    await c.connect();
    await c.borrow("10");
    const event = events.find((e) => e.type === "operationSubmitted");
    expect(event).toMatchObject({
      projectId: config.projectId,
      owner,
      account,
      hash,
      action: "borrow",
    });
    expect(JSON.stringify(events)).not.toContain("token");
  });
  it("does not send when on-chain execution authorization is missing", async () => {
    registered = false;
    const { c } = make();
    await c.connect();
    await c.borrow("10");
    expect(mock.write).not.toHaveBeenCalled();
    expect(c.getSnapshot().operation?.stage).toBe("failed");
  });
  it("keeps an in-flight transaction in its original project after update", async () => {
    const events: WidgetEvent[] = [];
    const { c } = make(events);
    await c.connect();
    let send!: (hash: Hex) => void;
    mock.write.mockImplementation(
      () =>
        new Promise<Hex>((resolve) => {
          send = resolve;
        }),
    );
    const operation = c.borrow("10");
    await vi.waitFor(() => expect(send).toBeTypeOf("function"));
    c.update({ config: { ...config, projectId: `0x${"cd".repeat(32)}` } });
    send(hash);
    await operation;
    expect(events.find((e) => e.type === "operationSubmitted")).toMatchObject({
      projectId: config.projectId,
      hash,
    });
    expect(localStorage.length).toBe(0);
    expect(c.getSnapshot().operation).toBeUndefined();
  });
  it("never replays a pending transaction after reload", async () => {
    saveOperation({
      ...config,
      owner,
      account,
      id: "saved",
      action: "borrow",
      stage: "confirming",
      hash,
      chainId: 998,
      createdAt: 1,
    });
    const { c } = make();
    await c.connect();
    await c.borrow("10");
    expect(mock.write).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(mock.receipt).not.toHaveBeenCalled();
    expect(c.getSnapshot().operation?.stage).toBe("submitted");
  });
  it("invalidates identity immediately on accountsChanged", async () => {
    const { c } = make();
    await c.connect();
    listeners.accountsChanged(["0x5555555555555555555555555555555555555555"]);
    expect(c.getSnapshot().owner).toBeUndefined();
    expect(c.getSnapshot().status).toBe("loading");
  });
  it("rejects new operations when a feature is disabled", async () => {
    const { c } = make();
    await c.connect();
    c.update({
      config: { ...config, features: { borrow: false, transfer: false } },
    });
    await expect(c.borrow("10")).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
    });
    await expect(c.accountTransfer("fundToTrade", "10")).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
    });
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("ignores legacy operations after their feature is hidden", async () => {
    saveOperation({
      ...config,
      owner,
      account,
      id: "pending-hidden",
      action: "borrow",
      stage: "confirming",
      hash,
      chainId: 998,
      createdAt: 1,
    });
    const { c } = make();
    await c.connect();
    c.update({ config: { ...config, features: { borrow: false } } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.getSnapshot().operation).toBeUndefined();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("keeps the next step only in this page and rechecks allowance", async () => {
    const events: WidgetEvent[] = [];
    const { c } = make(events);
    await c.connect();
    await c.accountTransfer("fundToTrade", "10");
    expect(c.getSnapshot().operation).toMatchObject({
      stage: "awaitingAction",
      hash,
      transferFlow: { step: "deposit" },
    });
    expect(events.filter((e) => e.type === "operationSubmitted")).toHaveLength(
      1,
    );
    expect(events.filter((e) => e.type === "operationSuccess")).toHaveLength(0);
    await c.continueTransfer();
    expect(mock.write).toHaveBeenCalledOnce();
    expect(c.getSnapshot().operation?.error).toContain("Approval");
    const read = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (call) =>
      call.functionName === "allowance" ? 10000000n : read(call),
    );
    await c.continueTransfer();
    expect(mock.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "approve",
      "depositFor",
    ]);
    expect(c.getSnapshot().operation?.stage).toBe("submitted");
    expect(events.filter((e) => e.type === "operationSubmitted")).toHaveLength(
      2,
    );
    expect(localStorage.length).toBe(0);
    const { c: fresh } = make();
    await fresh.connect();
    expect(fresh.getSnapshot().operation).toBeUndefined();
  });
  it.each([{ code: 4001 }, Error("RPC disconnected")])(
    "releases failed submissions for explicit retry: %s",
    async (error) => {
      const { c } = make();
      await c.connect();
      mock.write.mockRejectedValueOnce(error);
      await c.accountTransfer("fundToTrade", "10");
      expect(c.getSnapshot()).toMatchObject({
        busy: false,
        operation: {
          stage: "awaitingAction",
          transferFlow: { step: "approval" },
        },
      });
      await c.continueTransfer();
      expect(mock.write).toHaveBeenCalledTimes(2);
      expect(c.getSnapshot().operation?.transferFlow?.step).toBe("deposit");
    },
  );
  it("keeps the continuation and previous snapshot intact while a resumed wallet step is cancelled", async () => {
    const { c } = make();
    await c.connect();
    await c.accountTransfer("fundToTrade", "10");
    const previous = c.getSnapshot().continuation!;
    const read = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (call) =>
      call.functionName === "allowance" ? 10000000n : read(call),
    );
    let reject!: (error: unknown) => void;
    mock.write.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const running = c.continueTransfer();
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    expect(c.getSnapshot().continuation).toEqual(previous);
    expect(previous).toMatchObject({
      stage: "awaitingAction",
      hash,
      transferFlow: { step: "deposit" },
    });
    reject({ code: 4001 });
    await running;
    expect(c.getSnapshot()).toMatchObject({
      busy: false,
      continuation: {
        stage: "awaitingAction",
        transferFlow: { step: "deposit" },
      },
    });
    await c.continueTransfer();
    expect(c.getSnapshot().continuation).toBeUndefined();
    expect(mock.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "approve",
      "depositFor",
      "depositFor",
    ]);
    expect(previous.transferFlow?.completedHashes).toEqual([hash]);
  });
  it("allows other actions while a next step is available", async () => {
    const { c } = make();
    await c.connect();
    await c.accountTransfer("fundToTrade", "10");
    await c.borrow("10");
    expect(mock.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "approve",
      "borrow",
    ]);
    expect(c.getSnapshot().continuation?.transferFlow?.step).toBe("deposit");
    const read = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (call) =>
      call.functionName === "allowance" ? 10000000n : read(call),
    );
    await c.continueTransfer();
    expect(mock.write.mock.calls.at(-1)![0].functionName).toBe("depositFor");
    expect(c.getSnapshot().continuation).toBeUndefined();
  });
  it("keeps submitted status if background refresh fails and allows retry", async () => {
    const { c } = make();
    await c.connect();
    const read = mock.read.getMockImplementation()!;
    mock.write.mockImplementationOnce(async () => {
      mock.read.mockRejectedValue(Error("RPC unavailable"));
      return hash;
    });
    await c.borrow("10");
    await vi.waitFor(() =>
      expect(c.getSnapshot().error).toContain("RPC unavailable"),
    );
    expect(c.getSnapshot()).toMatchObject({
      busy: false,
      status: "ready",
      operation: { stage: "submitted", hash },
    });
    mock.read.mockImplementation(read);
    await c.borrow("10");
    expect(mock.write).toHaveBeenCalledTimes(2);
  });
  it("ignores corrupt storage and works with storage denied", async () => {
    localStorage.setItem(operationKey({ ...config, owner }), "{broken");
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw Error("denied");
      });
    try {
      const { c } = make();
      await c.connect();
      await c.borrow("10");
      expect(c.getSnapshot().operation?.stage).toBe("submitted");
    } finally {
      spy.mockRestore();
    }
  });
  it("discards an unfinished continuation on remount and context changes", async () => {
    const { c } = make();
    await c.connect();
    await c.accountTransfer("fundToTrade", "10");
    expect(c.getSnapshot().continuation).toBeDefined();
    const { c: fresh } = make();
    await fresh.connect();
    expect(fresh.getSnapshot().continuation).toBeUndefined();
    expect(fresh.getSnapshot().operation).toBeUndefined();
    c.update({ config: { ...config, projectId: `0x${"cd".repeat(32)}` } });
    expect(c.getSnapshot().continuation).toBeUndefined();
  });
  it("skips an approval retry already satisfied on chain without a new submitted event", async () => {
    const events: WidgetEvent[] = [];
    const { c } = make(events);
    await c.connect();
    mock.write.mockRejectedValueOnce(Error("RPC disconnected"));
    await c.accountTransfer("fundToTrade", "10");
    const read = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (call) =>
      call.functionName === "allowance" ? 10000000n : read(call),
    );
    await c.continueTransfer();
    expect(mock.write).toHaveBeenCalledOnce();
    expect(c.getSnapshot().continuation?.transferFlow?.step).toBe("deposit");
    expect(events.filter((e) => e.type === "operationSubmitted")).toHaveLength(
      0,
    );
  });
  it("does not perform backend login or personal_sign", async () => {
    const { c, wallet } = make();
    await c.connect();
    await c.refresh();
    expect(fetch).not.toHaveBeenCalled();
    expect(wallet.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "personal_sign" }),
    );
  });
  it("can open host login before any provider is available", async () => {
    const onConnect = vi.fn();
    const c = new WidgetController({ config, onConnect });
    controllers.push(c);
    expect(c.hasWallet).toBe(true);
    await c.connect();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toMatchObject({
      status: "disconnected",
      busy: false,
    });
  });
  it("clears account identity immediately on provider disconnect", async () => {
    const { c } = make();
    await c.connect();
    listeners.disconnect({ code: 4900 });
    expect(c.getSnapshot()).toMatchObject({
      status: "disconnected",
      owner: undefined,
      account: undefined,
    });
  });
  it("rechecks chain truth after host setup and never assumes callback success means authorized", async () => {
    registered = false;
    const { c } = make();
    await c.connect();
    const setup = vi.fn(async () => {});
    c.update({ onAccountSetup: setup });
    await c.setupAccount();
    expect(setup).toHaveBeenCalledWith(
      expect.objectContaining({
        owner,
        account,
        reasons: ["EXECUTION_AUTHORIZATION_REQUIRED"],
      }),
    );
    expect(c.getSnapshot().reasons).toContain(
      "EXECUTION_AUTHORIZATION_REQUIRED",
    );
    c.update({
      onAccountSetup: async () => {
        registered = true;
      },
    });
    await c.setupAccount();
    expect(c.getSnapshot().reasons).toEqual([]);
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("passes the verified owner into host gas funding and preserves cancellation", async () => {
    history([]);
    created = false;
    const { c } = make();
    await c.connect();
    const onGasTopUp = vi.fn(async () => {
      throw { code: 4001 };
    });
    c.update({ onGasTopUp });
    await c.topUpGas();
    expect(onGasTopUp).toHaveBeenCalledWith(
      expect.objectContaining({
        owner,
        network: "testnet",
        projectId: config.projectId,
      }),
    );
    expect(c.getSnapshot()).toMatchObject({
      status: "noAccount",
      busy: false,
      error: expect.stringContaining("declined"),
    });
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("unsubscribes and stops timers on destroy", async () => {
    const { c, wallet } = make();
    await c.connect();
    c.destroy();
    expect(wallet.removeListener).toHaveBeenCalledTimes(3);
  });
  it("withdraw feature blocks new withdrawals and legacy withdrawal routes", async () => {
    const { c } = make();
    await c.connect();
    c.update({ config: { ...config, features: { withdraw: false } } });
    await expect(c.withdraw("10", 9000000n)).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
    });
    await expect(c.transfer("tradeToFund", "10")).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
    });
    await expect(c.transfer("tradeToArbitrum", "10", 1n)).rejects.toMatchObject(
      { code: "FEATURE_DISABLED" },
    );
    expect(mock.write).not.toHaveBeenCalled();
  });
});

function history(items: unknown[]) {
  vi.mocked(fetch).mockImplementation(
    async () => new Response(JSON.stringify({ data: { items } })),
  );
}
describe("creation history guard", () => {
  const paid = {
    requested_usdc_amount_raw: "3000000",
    phase: "success",
    terminal: true,
  };
  it("restores server history in a fresh controller and skips host funding", async () => {
    created = false;
    history([paid]);
    const { c } = make();
    await c.connect();
    expect(await c.creationReadiness()).toMatchObject({
      gas: 1000000000000000000n,
      hasTopUp: true,
      funding: { state: "idle" },
      ready: true,
    });
    const callback = vi.fn();
    c.update({ onGasTopUp: callback });
    await c.topUpGas();
    expect(callback).not.toHaveBeenCalled();
    const { c: fresh } = make();
    await fresh.connect();
    expect((await fresh.creationReadiness()).ready).toBe(true);
  });
  it("blocks direct creation without payment even with sufficient gas", async () => {
    created = false;
    history([]);
    const { c } = make();
    await c.connect();
    await c.createAccount();
    expect(mock.sign).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
    expect(c.getSnapshot().operation?.error).toContain("3 USDC");
  });
  it("requires current gas and allows the host to replenish it", async () => {
    created = false;
    history([paid]);
    mock.gas.mockResolvedValue(0n);
    const { c } = make();
    await c.connect();
    expect((await c.creationReadiness()).ready).toBe(false);
    const callback = vi.fn();
    c.update({ onGasTopUp: callback });
    await c.topUpGas();
    expect(callback).toHaveBeenCalledOnce();
    await c.createAccount();
    expect(mock.write).not.toHaveBeenCalled();
  });
  it("blocks funding and creation when history is unavailable", async () => {
    created = false;
    const { c } = make();
    await c.connect();
    const callback = vi.fn();
    c.update({ onGasTopUp: callback });
    await c.topUpGas();
    await c.createAccount();
    expect(callback).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
    expect(c.getSnapshot().operation?.error).toContain("Unexpected HTTP");
  });
  it("rejects results from a previous wallet context", async () => {
    created = false;
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { c } = make();
    await c.connect();
    const check = c.creationReadiness();
    listeners.accountsChanged();
    resolve(new Response(JSON.stringify([paid])));
    await expect(check).rejects.toThrow("context changed");
  });
  it("rejects failed balance reads even when history is valid", async () => {
    history([paid]);
    const { c } = make();
    await c.connect();
    mock.gas.mockRejectedValue(new Error("RPC unavailable"));
    await expect(c.creationReadiness()).rejects.toThrow("RPC unavailable");
  });
});

it("coalesces concurrent modal reads and reads only the required contracts", async () => {
  const { c } = make();
  await c.connect();
  mock.read.mockClear();
  await Promise.all([c.quoteBorrow(), c.quoteBorrow()]);
  expect(mock.read.mock.calls.map(([call]) => call.functionName)).toEqual([
    "registry",
    "economicConfig",
    "getCurrentBorrowRate",
  ]);
  mock.read.mockClear();
  await Promise.all([
    c.fundSourceBalances("core"),
    c.fundSourceBalances("core"),
  ]);
  expect(mock.read.mock.calls.map(([call]) => call.functionName)).toEqual([
    "registry",
    "l1ReadAdapter",
    "readCoreUserExists",
    "readCoreSpotBalanceState",
  ]);
  mock.read.mockClear();
  c.config = { ...c.config, network: "mainnet" };
  await c.fundSourceBalances("fund");
  expect(mock.read.mock.calls.map(([call]) => call.functionName)).toEqual([
    "balanceOf",
    "allowance",
  ]);
  expect(mock.read.mock.calls[0][0]).toMatchObject({
    address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    args: [owner],
  });
});

it("withdrawal MAX uses live balances rather than the previously loaded account", async () => {
  const { c } = make();
  await c.connect();
  const old = c.getSnapshot().balances!.evm;
  const read = mock.read.getMockImplementation()!;
  mock.read.mockImplementation(async (call) => {
    if (call.functionName === "previewSafeUserClaimablePrimaryDirect")
      return 1000000000n;
    if (call.functionName === "getAccountRuntimeStatus")
      return { ...(await read(call)), availableAssetBalance: 2000000n };
    return read(call);
  });
  const result = await c.quoteWithdrawal();
  expect(result.maximum).toBe(2000000n + 50000000n - 5000n);
  expect(c.getSnapshot().balances!.evm).toBe(old);
});

it("Arbitrum maximum uses live Core API and interest without changing generic withdrawal quotes", async () => {
  const { c } = make();
  await c.connect();
  c.config = { ...c.config, network: "mainnet" };
  const read = mock.read.getMockImplementation()!;
  mock.read.mockImplementation(async (call) => {
    if (call.functionName === "asset")
      return "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
    if (call.functionName === "previewSafeUserClaimablePrimaryDirect")
      return 24000000n;
    if (call.functionName === "getAccountRuntimeStatus")
      return {
        ...(await read(call)),
        availableAssetBalance: 0n,
        payableInterestNow: 1000000n,
      };
    return read(call);
  });
  mock.info.mockResolvedValue({
    balances: [{ coin: "USDC", total: "25", hold: "0" }],
  });
  mock.read.mockClear();
  const [a, b] = await Promise.all([
    c.quoteArbitrumWithdrawal(),
    c.quoteArbitrumWithdrawal(),
  ]);
  expect(a.maximum).toBe(23995000n);
  expect(b).toEqual(a);
  expect(mock.read.mock.calls.map(([call]) => call.functionName)).toEqual([
    "asset",
    "getAccountRuntimeStatus",
    "previewSafeUserClaimablePrimaryDirect",
  ]);
  mock.info.mockRejectedValueOnce(new Error("Core offline"));
  await expect(c.quoteArbitrumWithdrawal()).rejects.toThrow("Core offline");
});

it("Arbitrum continuation replenishes accrued interest even after the Core receipt advanced to bridge", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify(
        [1000, 2000].map((finalityThreshold) => ({
          finalityThreshold,
          minimumFee: 0,
          forwardFee: { high: "100000" },
        })),
      ),
    ),
  );
  const { c } = make();
  await c.connect();
  const port = {
    read: vi.fn(async ({ functionName }) =>
      functionName === "getAccountRuntimeStatus"
        ? { availableAssetBalance: 10000000n, payableInterestNow: 1000000n }
        : 20000000n,
    ),
    coreSpotBalance: vi.fn().mockResolvedValue(2000000n),
    write: vi.fn().mockResolvedValue(hash),
  } as unknown as import("../src/protocol/port").ProtocolPort;
  const state = {
    account,
    asset: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
    balances: { evm: 10000000n, spot: 0n },
  } as unknown as import("../src/protocol/account").AccountState;
  const op = {
    arbitrumWithdrawal: { amount: "10000000", fee: "100000", step: "bridge" },
  } as import("../src/types").OperationRecord;
  await c["executeArbitrum"](port, c.config, owner, state, op);
  expect(port.write).toHaveBeenCalledWith(
    expect.objectContaining({
      functionName: "sendCoreSpotToEvm",
      args: [0n, 1000000n],
    }),
  );
  expect(op.arbitrumWithdrawal!.step).toBe("topup");
  vi.mocked(port.write).mockClear();
  vi.mocked(port.read).mockImplementation(
    async <T>({ functionName }: { functionName: string }) =>
      (functionName === "getAccountRuntimeStatus"
        ? { availableAssetBalance: 10000000n, payableInterestNow: 3000000n }
        : 20000000n) as T,
  );
  await expect(
    c["executeArbitrum"](port, c.config, owner, state, op),
  ).rejects.toMatchObject({ code: "WITHDRAW_RESTRICTED" });
  expect(port.write).not.toHaveBeenCalled();
});

describe("creation payment history opt-out", () => {
  async function setup() {
    created = false;
    const { c } = make();
    c.update({ config: { ...config, skipCreationTopUpCheck: true } });
    await c.connect();
    return c;
  }
  it.each([10000000000000000n, 10000000000000001n])(
    "creates without history at balance %s",
    async (balance) => {
      const c = await setup();
      mock.gas.mockResolvedValue(balance);
      expect(await c.creationReadiness()).toMatchObject({
        ready: true,
        hasTopUp: false,
      });
      await c.topUpGas();
      const callback = vi.fn();
      c.update({ onGasTopUp: callback });
      await c.topUpGas();
      expect(callback).not.toHaveBeenCalled();
      await c.createAccount();
      expect(mock.write).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("rechecks a falling balance and allows host replenishment", async () => {
    const c = await setup();
    expect((await c.creationReadiness()).ready).toBe(true);
    mock.gas.mockResolvedValue(9999999999999999n);
    await c.createAccount();
    expect(mock.write).not.toHaveBeenCalled();
    expect(c.getSnapshot().operation?.error).toContain("0.01 HYPE");
    const callback = vi.fn(async () => {
      mock.gas.mockResolvedValue(10000000000000000n);
    });
    c.update({ onGasTopUp: callback });
    await c.topUpGas();
    expect(callback).toHaveBeenCalledOnce();
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks when the gas RPC fails", async () => {
    const c = await setup();
    mock.gas.mockRejectedValue(new Error("RPC unavailable"));
    await c.createAccount();
    expect(mock.write).not.toHaveBeenCalled();
    expect(c.getSnapshot().operation?.error).toContain("RPC unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["config", "wallet"])(
    "rejects stale gas reads after %s changes",
    async (kind) => {
      const c = await setup();
      let resolve!: (value: bigint) => void;
      mock.gas.mockImplementationOnce(
        () =>
          new Promise<bigint>((r) => {
            resolve = r;
          }),
      );
      const pending = c.creationReadiness();
      if (kind === "config")
        c.update({ config: { ...config, skipCreationTopUpCheck: false } });
      else listeners.accountsChanged();
      resolve(10000000000000000n);
      await expect(pending).rejects.toThrow("context changed");
      await c.connect();
      if (kind === "config") {
        history([]);
        expect((await c.creationReadiness()).ready).toBe(false);
      }
    },
  );
});

describe("creation confirmation", () => {
  async function submitPending() {
    created = false;
    const { c } = make();
    c.update({ config: { ...config, skipCreationTopUpCheck: true } });
    await c.connect();
    await c.createAccount();
    await c.refresh();
    return c;
  }
  it("keeps creation pending until the primary account is verified, without resubmitting", async () => {
    const c = await submitPending();
    expect(c.getSnapshot()).toMatchObject({
      status: "noAccount",
      creationPending: true,
    });
    expect((await c.creationReadiness()).ready).toBe(false);
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledOnce();
    created = true;
    await c.refresh();
    expect(c.getSnapshot()).toMatchObject({
      status: "ready",
      account,
      creationPending: false,
    });
  });
  it("restores creation after remount and survives receipt read failure", async () => {
    const c = await submitPending();
    c.destroy();
    mock.receipt.mockRejectedValueOnce(Error("RPC unavailable"));
    const { c: fresh } = make();
    await fresh.connect();
    expect(fresh.getSnapshot().creationPending).toBe(true);
    expect(mock.write).toHaveBeenCalledOnce();
    created = true;
    await fresh.refresh();
    expect(fresh.getSnapshot()).toMatchObject({
      status: "ready",
      creationPending: false,
    });
  });
  it("clears pending creation only after an explicit revert", async () => {
    const c = await submitPending();
    mock.receipt.mockResolvedValueOnce({ status: "reverted" });
    await c.refresh();
    expect(c.getSnapshot().creationPending).toBe(false);
    expect(c.getSnapshot().error).toContain("reverted");
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledTimes(2);
  });
  it("does not report success for an initialized account with the wrong project", async () => {
    const c = await submitPending();
    const original = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(async (call) =>
      call.functionName === "projectId"
        ? `0x${"cd".repeat(32)}`
        : original(call),
    );
    created = true;
    await c.refresh();
    expect(c.getSnapshot()).toMatchObject({
      status: "noAccount",
      creationPending: true,
    });
    expect(c.getSnapshot().error).toContain("does not match");
  });
});

describe("creation signature error recovery", () => {
  async function setup() {
    created = false;
    const result = make();
    result.c.update({ config: { ...config, skipCreationTopUpCheck: true } });
    await result.c.connect();
    return result;
  }
  it.each([
    { code: 4001 },
    { error: { data: { originalError: { code: "4001" } } } },
    Error("Signing service unavailable"),
  ])("releases the operation after a signature failure: %j", async (error) => {
    const { c } = await setup();
    mock.sign.mockRejectedValueOnce(error);
    await c.createAccount();
    expect(c.getSnapshot()).toMatchObject({
      busy: false,
      creationPending: false,
      operation: { stage: "failed" },
    });
    expect(mock.write).not.toHaveBeenCalled();
    expect(
      loadCreation(creationKey(c.config, owner, "create")),
    ).toBeUndefined();
    expect((await c.creationReadiness()).ready).toBe(true);
    await c.createAccount();
    expect(mock.sign).toHaveBeenCalledTimes(2);
    expect(mock.write).toHaveBeenCalledOnce();
  });
  it("does not access cancellation storage before any submission", async () => {
    const { c } = await setup();
    const remove = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw Error("Storage denied");
      });
    try {
      mock.sign.mockRejectedValueOnce({ code: 4001 });
      await c.createAccount();
      expect(remove).not.toHaveBeenCalled();
      expect(c.getSnapshot()).toMatchObject({
        busy: false,
        operation: { stage: "failed" },
      });
      expect(c.getSnapshot().operation?.error).toContain("declined");
    } finally {
      remove.mockRestore();
    }
  });
  it("recovers after a delayed signature rejection and a controller remount", async () => {
    const { c } = await setup();
    let reject!: (error: unknown) => void;
    mock.sign.mockImplementationOnce(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    const running = c.createAccount();
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    expect(c.getSnapshot().operation?.stage).toBe("signing");
    expect(
      loadCreation(creationKey(c.config, owner, "create")),
    ).toBeUndefined();
    reject({ info: { error: { code: 4001 } } });
    await running;
    c.destroy();
    const { c: reopened } = await setup();
    expect((await reopened.creationReadiness()).ready).toBe(true);
    await reopened.createAccount();
    expect(mock.write).toHaveBeenCalledOnce();
  });
  it("does not persist creation after wrapped transaction rejection", async () => {
    const { c } = await setup();
    mock.write.mockRejectedValueOnce({
      data: { originalError: { code: 4001 } },
    });
    await c.createAccount();
    expect(c.getSnapshot()).toMatchObject({
      busy: false,
      creationPending: false,
      operation: { stage: "failed" },
    });
    expect(
      loadCreation(creationKey(c.config, owner, "create")),
    ).toBeUndefined();
    expect((await c.creationReadiness()).ready).toBe(true);
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledTimes(2);
  });
  it("allows explicit creation retry when no transaction hash was returned", async () => {
    const { c } = await setup();
    mock.write.mockRejectedValueOnce(Error("Network connection closed"));
    await c.createAccount();
    expect(
      loadCreation(creationKey(c.config, owner, "create")),
    ).toBeUndefined();
    expect(c.getSnapshot().creationPending).toBe(false);
    expect(c.getSnapshot().operation?.error).toContain(
      "Submission result is unknown",
    );
    expect((await c.creationReadiness()).ready).toBe(true);
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledTimes(2);
  });
  it("discards legacy hashless creation without deleting funding history", async () => {
    const { c } = await setup();
    const key = creationKey(c.config, owner, "create");
    const fundingKey = creationKey(c.config, owner);
    const record = {
      source: "create",
      receiver: c.config.factory,
      hypeBefore: "0",
      createdAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(record));
    const funding = JSON.stringify({ ...record, source: "core" });
    localStorage.setItem(fundingKey, funding);
    await c.refresh();
    expect(c.getSnapshot()).toMatchObject({
      status: "noAccount",
      creationPending: false,
    });
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(fundingKey)).toBe(funding);
    expect(mock.receipt).not.toHaveBeenCalled();
    localStorage.removeItem(fundingKey);
    expect((await c.creationReadiness()).ready).toBe(true);
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledOnce();
  });
  it("does not persist a creation request while the wallet has not returned a hash", async () => {
    const { c } = await setup();
    let reject!: (error: unknown) => void;
    mock.write.mockImplementationOnce(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    const running = c.createAccount();
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    expect(c.getSnapshot()).toMatchObject({
      busy: true,
      creationPending: false,
    });
    expect(
      loadCreation(creationKey(c.config, owner, "create")),
    ).toBeUndefined();
    reject({ code: 4001 });
    await running;
    expect((await c.creationReadiness()).ready).toBe(true);
  });
  it("does not overwrite a new context with a late signature error", async () => {
    const { c } = await setup();
    let reject!: (error: unknown) => void;
    mock.sign.mockImplementationOnce(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    const running = c.createAccount();
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    c.update({
      config: {
        ...config,
        skipCreationTopUpCheck: true,
        rpcUrl: "https://new.example/rpc",
      },
    });
    await c.refresh();
    const snapshot = c.getSnapshot();
    reject({ code: 4001 });
    await running;
    expect(c.getSnapshot()).toEqual(snapshot);
    await c.createAccount();
    expect(mock.write).toHaveBeenCalledOnce();
  });
});

describe("independent creation requirements", () => {
  const activation = {
    id: "11111111-1111-4111-8111-111111111111",
    user_eoa: owner,
    status: "waiting_account",
  };
  async function configured(gas: boolean, activate: boolean, skip = false) {
    created = false;
    const { c } = make();
    c.update({
      config: {
        ...config,
        creationGasConversionEnabled: gas,
        creationAccountActivationEnabled: activate,
        skipCreationTopUpCheck: skip,
      },
    });
    await c.connect();
    mock.gas.mockClear();
    vi.mocked(fetch).mockClear();
    return c;
  }
  it("creates without HYPE or payment services when both features are off", async () => {
    const c = await configured(false, false);
    mock.gas.mockRejectedValue(Error("Do not query gas"));
    vi.mocked(fetch).mockRejectedValue(Error("Do not query service"));
    expect((await c.creationReadiness()).ready).toBe(true);
    await c.createAccount();
    expect(mock.sign).toHaveBeenCalled();
    expect(mock.write).toHaveBeenCalled();
    expect(mock.gas).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["waiting_account", "submitting", "activated"])(
    "accepts activation %s without querying Gas",
    async (status) => {
      const c = await configured(false, true);
      history([{ ...activation, status }]);
      mock.gas.mockRejectedValue(Error("Do not query gas"));
      expect((await c.creationReadiness()).ready).toBe(true);
      await c.createAccount();
      expect(mock.write).toHaveBeenCalled();
      expect(mock.gas).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.every(([url]) =>
            String(url).includes("account-activations"),
          ),
      ).toBe(true);
    },
  );
  it("does not treat an active unpaid order as confirmed activation", async () => {
    const c = await configured(false, true, true);
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            data: String(url).includes("/config")
              ? { enabled: true, status: "activation_pending" }
              : { items: [] },
          }),
        ),
    );
    expect((await c.creationReadiness()).ready).toBe(false);
    await c.createAccount();
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it("accepts service evidence of already activated accounts", async () => {
    const c = await configured(false, true);
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            data: String(url).includes("/config")
              ? { enabled: true, status: "already_activated" }
              : { items: [] },
          }),
        ),
    );
    expect((await c.creationReadiness()).ready).toBe(true);
  });
  it("queries only conversions when activation is disabled", async () => {
    const c = await configured(true, false);
    history([
      {
        id: "gas",
        user_eoa: owner,
        requested_usdc_amount_raw: "3000000",
        phase: "success",
        terminal: true,
      },
    ]);
    expect((await c.creationReadiness()).ready).toBe(true);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([url]) => String(url).includes("gas-conversions")),
    ).toBe(true);
  });
  it("keeps explicit combined activation required even when Gas history is skipped", async () => {
    const c = await configured(true, true, true);
    const paid = {
      requested_usdc_amount_raw: "3000000",
      phase: "success",
      terminal: true,
    };
    history([paid]);
    expect((await c.creationReadiness()).ready).toBe(false);
    history([
      {
        ...paid,
        cost_breakdown: {
          activation_required: true,
          activation_fee_reserved_usdc_amount_raw: "1000000",
          activation_transfer_reserved_usdc_amount_raw: "100000",
        },
      },
    ]);
    expect((await c.creationReadiness()).ready).toBe(true);
  });
  it("does not let an unrelated pending payment service failure block both-off creation", async () => {
    const c = await configured(false, false);
    localStorage.setItem(
      creationKey(c.config, owner),
      JSON.stringify({
        source: "core",
        receiver: account,
        hypeBefore: "0",
        createdAt: Date.now(),
      }),
    );
    vi.mocked(fetch).mockRejectedValue(Error("Old payment service offline"));
    expect((await c.creationReadiness()).ready).toBe(true);
    expect(loadCreation(creationKey(c.config, owner))).toBeDefined();
  });
  it("invalidates a delayed activation check after switching the feature off", async () => {
    const c = await configured(false, true);
    let respond!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((r) => {
          respond = r;
        }),
    );
    const reading = c.creationReadiness();
    c.update({
      config: {
        ...config,
        creationGasConversionEnabled: false,
        creationAccountActivationEnabled: false,
      },
    });
    respond(new Response(JSON.stringify({ data: { items: [activation] } })));
    await expect(reading).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    await c.connect();
    expect((await c.creationReadiness()).ready).toBe(true);
  });
  it("passes the activation mode and exact amount to the existing host callback", async () => {
    const c = await configured(false, true);
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            data: String(url).includes("/config")
              ? { enabled: true, status: "ready_to_pay" }
              : { items: [] },
          }),
        ),
    );
    const callback = vi.fn();
    c.update({ onGasTopUp: callback });
    await c.topUpGas();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        owner,
        flow: "activation_only",
        amountRaw: "1100000",
      }),
    );
  });
});

it("does not mistake zero combined activation allocation for paid activation", async () => {
  created = false;
  const { c } = make();
  c.update({
    config: {
      ...config,
      creationGasConversionEnabled: true,
      creationAccountActivationEnabled: true,
    },
  });
  await c.connect();
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify({
          data: String(url).includes("gas-top-ups")
            ? {
                items: [
                  {
                    requested_usdc_amount_raw: "3000000",
                    phase: "success",
                    terminal: true,
                    cost_breakdown: {
                      activation_required: false,
                      activation_fee_reserved_usdc_amount_raw: "0",
                      activation_transfer_reserved_usdc_amount_raw: "0",
                    },
                  },
                ],
              }
            : String(url).includes("/config")
              ? { enabled: false, status: "unavailable" }
              : { items: [] },
        }),
      ),
  );
  expect((await c.creationReadiness()).ready).toBe(false);
});
