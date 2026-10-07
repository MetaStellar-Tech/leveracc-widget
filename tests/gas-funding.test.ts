import {
  creationKey,
  loadCreation,
  fundingStatus,
  clearCreation,
} from "../src/protocol/creation-tracking";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Address } from "viem";
import { resolveConfig } from "../src/core/config";
import type { ProtocolPort } from "../src/protocol/port";
import type { WalletProvider } from "../src/types";
import { IERC20ABI } from "../src/abi/IERC20";
const m = vi.hoisted(() => ({
  signer: vi.fn(),
  write: vi.fn(),
  chain: vi.fn(),
  balance: vi.fn(),
  simulate: vi.fn(),
  receipt: vi.fn(),
  native: vi.fn(),
  core: vi.fn(),
}));
vi.mock("../src/core/wallet", () => ({ signer: m.signer }));
vi.mock("../src/protocol/port", () => ({
  publicRpc: (chain: { id: number }) => ({
    getChainId: () => m.chain(chain.id),
    readContract: m.balance,
    simulateContract: m.simulate,
    estimateContractGas: async () => 100n,
    getGasPrice: async () => 1n,
    getBalance: m.native,
    getTransactionReceipt: m.receipt,
  }),
}));
import {
  startGasFunding,
  gasFundingRoute,
  ARBITRUM_USDC,
} from "../src/protocol/gas-funding";
import {
  gasFundingKey,
  withGasFundingLock,
} from "../src/protocol/gas-funding-store";
const owner = "0x1111111111111111111111111111111111111111";
const receiver = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}` as const;
const targetHash = `0x${"cd".repeat(32)}` as const;
const config = resolveConfig({
  network: "mainnet",
  projectId: `0x${"ab".repeat(32)}`,
});
const testnet = resolveConfig({ ...config, network: "testnet" });
const port = {
  nativeBalance: async () => 0n,
  read: vi.fn(async ({ functionName }: { functionName: string }) =>
    functionName === "readCoreSpotBalanceState"
      ? { total: 400_000_000n, hold: 0n }
      : functionName === "readCoreUserExists"
        ? true
        : receiver,
  ),
} as unknown as ProtocolPort;
const provider = {} as WalletProvider;
let service: Record<string, unknown>, history: unknown[], status: unknown;
const key = gasFundingKey(config, owner);
const testKey = gasFundingKey(testnet, owner);
const record = {
  id: "new",
  requested_usdc_amount_raw: "3000000",
  source_chain_id: 42161,
  source_tx_hash: hash,
  phase: "success",
  terminal: true,
  evm_tx_hash: targetHash,
};
function start(current = () => true) {
  return startGasFunding(config, provider, owner, port, current, () => port);
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  m.signer.mockResolvedValue({ writeContract: m.write });
  m.write.mockResolvedValue(hash);
  m.chain.mockImplementation(async (id) => id);
  m.balance.mockResolvedValue(4_000_000n);
  m.native.mockResolvedValue(1_000_000n);
  m.simulate.mockResolvedValue({
    result: true,
    request: {
      address: ARBITRUM_USDC,
      abi: IERC20ABI,
      functionName: "transfer",
      args: [receiver, 3_000_000n],
    },
  });
  m.core.mockResolvedValue(undefined);
  service = {
    enabled: true,
    min_usdc_amount_raw: "1000000",
    max_usdc_amount_raw: "10000000",
    system_core_account_address: receiver,
    arbitrum: {
      enabled: true,
      chain_id: 42161,
      usdc_address: ARBITRUM_USDC,
      receiver_address: receiver,
      confirmations: 2,
      daily_eoa_limit_raw: "10000000",
      min_usdc_amount_raw: "1000000",
      max_usdc_amount_raw: "10000000",
    },
  };
  history = [];
  status = record;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify({
            data: url.endsWith("/config")
              ? service
              : url.includes("?")
                ? { items: history }
                : status,
          }),
        ),
    ),
  );
  m.receipt.mockImplementation(async ({ hash: requested }: { hash: string }) =>
    requested === targetHash
      ? { status: "success", to: owner }
      : {
          status: "success",
          logs: [
            {
              address: ARBITRUM_USDC,
              topics: encodeEventTopics({
                abi: IERC20ABI,
                eventName: "Transfer",
                args: { from: owner, to: receiver },
              }),
              data: encodeAbiParameters([{ type: "uint256" }], [3_000_000n]),
            },
          ],
        },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("sends exactly 3 native Arbitrum USDC and persists the transfer before tracking", async () => {
  await start();
  expect(m.signer).toHaveBeenCalledWith(
    provider,
    owner,
    expect.objectContaining({ id: 42161 }),
    expect.any(Function),
  );
  expect(m.write).toHaveBeenCalledWith(
    expect.objectContaining({
      address: ARBITRUM_USDC,
      functionName: "transfer",
      args: [receiver, 3_000_000n],
    }),
  );
  expect(loadCreation(creationKey(config, owner))).toMatchObject({
    hash,
    receiver,
    hypeBefore: "0",
  });
  expect(m.receipt).not.toHaveBeenCalled();
  expect(m.write).toHaveBeenCalledOnce();
});
it("skips funding when fresh history and gas already satisfy creation", async () => {
  history = [record];
  await startGasFunding(
    config,
    provider,
    owner,
    { ...port, nativeBalance: async () => 10000000000000000n },
    () => true,
    () => port,
  );
  expect(m.write).not.toHaveBeenCalled();
});
it.each(["balance", "eth", "route", "rpc", "owner"])(
  "blocks unsafe submission: %s",
  async (kind) => {
    if (kind === "balance") m.balance.mockResolvedValue(2_999_999n);
    if (kind === "eth") m.native.mockResolvedValue(0n);
    if (kind === "route") service.enabled = false;
    if (kind === "rpc") m.chain.mockResolvedValue(1);
    if (kind === "owner")
      m.signer.mockRejectedValue(new Error("owner mismatch"));
    await expect(start()).rejects.toThrow();
    expect(m.write).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  },
);
it("blocks broadcast when pending storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("storage blocked");
  });
  await expect(start()).rejects.toThrow("storage blocked");
  expect(m.write).not.toHaveBeenCalled();
});
it("blocks a second payment after an unknown submission", async () => {
  m.write.mockRejectedValueOnce(Error("RPC disconnected"));
  await expect(start()).rejects.toThrow("disconnected");
  await expect(start()).rejects.toMatchObject({ code: "FUNDING_PENDING" });
  expect(m.write).toHaveBeenCalledOnce();
});
it("allows a new attempt after explicit wallet rejection", async () => {
  m.write.mockRejectedValueOnce({ code: 4001 });
  await expect(start()).rejects.toMatchObject({ code: 4001 });
  await expect(start()).resolves.toMatchObject({ hash });
});
it("returns the hash even if the wallet context changes during broadcast", async () => {
  let current = true;
  m.write.mockImplementationOnce(async () => {
    current = false;
    return hash;
  });
  await expect(start(() => current)).resolves.toMatchObject({ hash });
});
it("refuses to submit after a context change during preflight", async () => {
  await expect(start(() => false)).rejects.toMatchObject({
    code: "CONTEXT_CHANGED",
  });
  expect(m.write).not.toHaveBeenCalled();
});
it.each(["processing", "failed"])(
  "does not lock funding on service history %s",
  async (phase) => {
    history = [{ ...record, phase, terminal: phase === "failed" }];
    localStorage.setItem(key, "{corrupt old transaction");
    await expect(start()).resolves.toMatchObject({ hash });
    expect(m.receipt).not.toHaveBeenCalled();
  },
);
it("persists testnet Core funding for arrival tracking", async () => {
  await expect(
    startGasFunding(
      testnet,
      provider,
      owner,
      port,
      () => true,
      (submitting) => ({
        ...port,
        sendCore: async (to, amount) => {
          submitting();
          await m.core(to, amount);
        },
      }),
    ),
  ).resolves.toEqual({ source: "core" });
  expect(m.core).toHaveBeenCalledWith(receiver, "3");
  expect(m.write).not.toHaveBeenCalled();
  expect(m.receipt).not.toHaveBeenCalled();
  expect(loadCreation(creationKey(testnet, owner))?.source).toBe("core");
});
it("does not use a malformed receiver or a different Arbitrum token", async () => {
  (service.arbitrum as Record<string, unknown>).usdc_address = receiver;
  await expect(gasFundingRoute(config)).rejects.toThrow();
  service.system_core_account_address =
    "0x0000000000000000000000000000000000000000";
  await expect(gasFundingRoute(testnet)).rejects.toThrow();
});
it("shares a funding lock across widgets and isolates storage by owner and network", async () => {
  expect(gasFundingKey(config, owner)).not.toBe(gasFundingKey(testnet, owner));
  expect(gasFundingKey(config, receiver as Address)).not.toBe(key);
  let release!: () => void;
  const first = withGasFundingLock(
    key,
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await expect(withGasFundingLock(key, async () => {})).rejects.toMatchObject({
    code: "OPERATION_BUSY",
  });
  release();
  await first;
});

it.each([config, testnet])(
  "funds without history in opt-out mode on $network",
  async (preset) => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (!String(url).endsWith("/config")) throw Error("History unavailable");
      return new Response(JSON.stringify({ data: service }));
    });
    const corePort = { ...port, sendCore: m.core };
    await startGasFunding(
      { ...preset, skipCreationTopUpCheck: true },
      provider,
      owner,
      port,
      () => true,
      () => corePort,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      preset.network === "mainnet" ? m.write : m.core,
    ).toHaveBeenCalledOnce();
  },
);
it.each([config, testnet])(
  "skips all funding service requests when HYPE is sufficient on $network",
  async (preset) => {
    vi.mocked(fetch).mockRejectedValue(new Error("Service unavailable"));
    await startGasFunding(
      { ...preset, skipCreationTopUpCheck: true },
      provider,
      owner,
      { ...port, nativeBalance: async () => 10000000000000000n },
      () => true,
      () => port,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(m.core).not.toHaveBeenCalled();
  },
);

it("restores a submitted payment and waits for service completion and HYPE", async () => {
  await start();
  await expect(start()).rejects.toMatchObject({ code: "FUNDING_PENDING" });
  expect((await fundingStatus(config, owner, 0n, [])).state).toBe("pending");
  const processing = {
    ...record,
    phase: "processing",
    terminal: false,
    next_poll_after_seconds: 8,
  };
  status = processing;
  expect(await fundingStatus(config, owner, 0n, [processing])).toMatchObject({
    state: "pending",
    pollAfter: 8000,
  });
  status = record;
  expect((await fundingStatus(config, owner, 0n, [record])).state).toBe(
    "pending",
  );
  expect(
    (await fundingStatus(config, owner, 10000000000000000n, [record])).state,
  ).toBe("idle");
  expect(loadCreation(creationKey(config, owner))).toBeUndefined();
  expect(m.write).toHaveBeenCalledOnce();
});
it("keeps a payment locked across RPC errors and terminal service failure", async () => {
  await start();
  m.receipt.mockRejectedValueOnce(Error("RPC offline"));
  await expect(fundingStatus(config, owner, 0n, [record])).rejects.toThrow(
    "RPC offline",
  );
  await expect(start()).rejects.toMatchObject({ code: "FUNDING_PENDING" });
  status = { ...record, phase: "failed", status_message: "Contact support" };
  expect(await fundingStatus(config, owner, 0n, [record])).toMatchObject({
    state: "failed",
    error: "Contact support",
  });
  await expect(start()).rejects.toMatchObject({ code: "FUNDING_PENDING" });
});
it("rejects mismatched transfer logs and service records", async () => {
  await start();
  const receipt = await m.receipt({ hash });
  m.receipt.mockResolvedValueOnce({ ...receipt, logs: [] });
  await expect(
    fundingStatus(config, owner, 1n, [record]),
  ).rejects.toMatchObject({ code: "FUNDING_MISMATCH" });
  status = { ...record, source_tx_hash: targetHash };
  await expect(
    fundingStatus(config, owner, 1n, [record]),
  ).rejects.toMatchObject({ code: "FUNDING_MISMATCH" });
});
it("allows retry only after an explicitly reverted funding transaction", async () => {
  await start();
  m.receipt.mockResolvedValueOnce({ status: "reverted" });
  expect((await fundingStatus(config, owner, 0n, [])).state).toBe("idle");
  await expect(start()).resolves.toMatchObject({ hash });
});

it("retains a returned hash when storage fails after broadcast", async () => {
  const original = Storage.prototype.setItem;
  let writes = 0;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, k, v) {
      if (++writes > 1) throw Error("storage unavailable");
      original.call(this, k, v);
    });
  await expect(start()).resolves.toMatchObject({ hash });
  expect(loadCreation(creationKey(config, owner))?.hash).toBe(hash);
  await expect(start()).rejects.toMatchObject({ code: "FUNDING_PENDING" });
  spy.mockRestore();
  clearCreation(creationKey(config, owner));
});
