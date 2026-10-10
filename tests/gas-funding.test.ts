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
const testnet = resolveConfig({
  projectId: config.projectId,
  network: "testnet",
});
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

const orderId = "11111111-1111-4111-8111-111111111111";
const matchedId = "22222222-2222-4222-8222-222222222222";
const nonce = "33333333-3333-4333-8333-333333333333";
function standalone(gas: boolean, network: "mainnet" | "testnet" = "mainnet") {
  return resolveConfig({
    projectId: config.projectId,
    network,
    creationGasConversionEnabled: gas,
    creationAccountActivationEnabled: !gas,
  });
}
function paymentService(
  gas: boolean,
  source: "arbitrum" | "core" = "arbitrum",
) {
  const flow = gas ? "gas_only" : "activation_only";
  const raw = gas ? "3000000" : "1100000";
  let order: Record<string, unknown> | undefined;
  const expires = new Date(
    Math.floor(Date.now() / 1000) * 1000 + 600000,
  ).toISOString();
  const challenge = {
    flow,
    source,
    user_eoa: owner,
    receiver_address: receiver,
    amount_raw: raw,
    nonce,
    expires_at: expires,
    signing_message: `LeverAcc Gas Station Payment Intent\nVersion: 1\nFlow: ${flow}\nSource: ${source}\nPayer: ${owner}\nReceiver: ${receiver}\nAmountRaw: ${raw}\nNonce: ${nonce}\nExpiresAt: ${Date.parse(expires) / 1000}`,
  };
  const signMessage = vi.fn(async () => "0x1234");
  m.signer.mockResolvedValue({ writeContract: m.write, signMessage });
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const path = String(url);
    let data: unknown;
    if (path.includes("/config"))
      data = gas
        ? service
        : {
            enabled: true,
            status: order ? "activation_pending" : "ready_to_pay",
            payment_usdc_amount_raw: raw,
            activation_receiver_address: receiver,
            arbitrum: service.arbitrum,
          };
    else if (path.endsWith("/challenge")) data = challenge;
    else if (path.endsWith("/orders") && options?.method === "POST") {
      order = { ...challenge, id: orderId, status: "awaiting_payment" };
      data = order;
    } else if (path.includes("/orders?"))
      data = { items: order ? [order] : [] };
    else if (path.endsWith(`/orders/${orderId}`)) data = order;
    else if (path.endsWith(`/${matchedId}`))
      data = gas
        ? { ...record, id: matchedId, user_eoa: owner }
        : {
            id: matchedId,
            user_eoa: owner,
            status: "waiting_account",
            source_chain_id: 42161,
            source_tx_hash: hash,
          };
    else
      data = {
        items:
          order?.status === "matched" && gas
            ? [{ ...record, id: matchedId, user_eoa: owner }]
            : [],
      };
    return new Response(JSON.stringify({ data }));
  });
  m.simulate.mockResolvedValue({
    result: true,
    request: {
      address: ARBITRUM_USDC,
      abi: IERC20ABI,
      functionName: "transfer",
      args: [receiver, BigInt(raw)],
    },
  });
  m.receipt.mockImplementation(async ({ hash: h }) =>
    h === targetHash
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
              data: encodeAbiParameters([{ type: "uint256" }], [BigInt(raw)]),
            },
          ],
        },
  );
  return {
    signMessage,
    challenge,
    match: () => {
      order = {
        ...order,
        status: "matched",
        [gas ? "matched_top_up_id" : "matched_activation_id"]: matchedId,
      };
    },
  };
}
it.each([true, false])(
  "signs an order and transfers the exact standalone amount (gas=%s)",
  async (gas) => {
    const cfg = standalone(gas);
    const api = paymentService(gas);
    const balance = vi.fn(async () => 0n);
    await startGasFunding(
      cfg,
      provider,
      owner,
      { ...port, nativeBalance: balance },
      () => true,
      () => port,
    );
    expect(api.signMessage).toHaveBeenCalledWith({
      message: api.challenge.signing_message,
    });
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining({ args: [receiver, gas ? 3000000n : 1100000n] }),
    );
    expect(loadCreation(creationKey(cfg, owner))).toMatchObject({
      flow: gas ? "gas_only" : "activation_only",
      amountRaw: gas ? "3000000" : "1100000",
      orderId,
    });
    if (!gas) expect(balance).not.toHaveBeenCalled();
    expect((await fundingStatus(cfg, owner, 0n, [])).state).toBe("pending");
    api.match();
    expect(
      (await fundingStatus(cfg, owner, gas ? 10000000000000000n : 0n, []))
        .state,
    ).toBe("idle");
    expect(loadCreation(creationKey(cfg, owner))).toBeUndefined();
  },
);
it("resumes the same order after transfer rejection without another order signature", async () => {
  const cfg = standalone(false);
  const api = paymentService(false);
  m.write.mockRejectedValueOnce({ code: 4001 });
  await expect(
    startGasFunding(
      cfg,
      provider,
      owner,
      port,
      () => true,
      () => port,
    ),
  ).rejects.toMatchObject({ code: 4001 });
  await startGasFunding(
    cfg,
    provider,
    owner,
    port,
    () => true,
    () => port,
  );
  expect(api.signMessage).toHaveBeenCalledOnce();
});
it.each(["receiver_address", "amount_raw", "flow", "signing_message"])(
  "rejects a mismatched challenge field %s before signing",
  async (field) => {
    const cfg = standalone(false);
    const api = paymentService(false);
    Object.assign(api.challenge, {
      [field]:
        field === "receiver_address"
          ? owner
          : field === "amount_raw"
            ? "3000000"
            : field === "flow"
              ? "gas_only"
              : "malicious message",
    });
    await expect(
      startGasFunding(
        cfg,
        provider,
        owner,
        port,
        () => true,
        () => port,
      ),
    ).rejects.toThrow();
    expect(api.signMessage).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
  },
);
it("never transfers when the order signature is rejected", async () => {
  const api = paymentService(false);
  api.signMessage.mockRejectedValueOnce({ code: 4001 });
  await expect(
    startGasFunding(
      standalone(false),
      provider,
      owner,
      port,
      () => true,
      () => port,
    ),
  ).rejects.toMatchObject({ code: 4001 });
  expect(m.write).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
it("persists and restores a standalone Core activation payment", async () => {
  const cfg = standalone(false, "testnet");
  const api = paymentService(false, "core");
  await startGasFunding(
    cfg,
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
  );
  expect(m.core).toHaveBeenCalledWith(receiver, "1.1");
  expect((await fundingStatus(cfg, owner, 0n, [])).state).toBe("pending");
  api.match();
  expect((await fundingStatus(cfg, owner, 0n, [])).state).toBe("idle");
});
it("blocks transfer if the payment order expires while the wallet is switching", async () => {
  const cfg = standalone(false);
  const api = paymentService(false);
  const originalNow = Date.now();
  let signatures = 0;
  m.signer.mockImplementation(async () => {
    if (++signatures === 4)
      vi.spyOn(Date, "now").mockReturnValue(originalNow + 600001);
    return { writeContract: m.write, signMessage: api.signMessage };
  });
  await expect(
    startGasFunding(
      cfg,
      provider,
      owner,
      port,
      () => true,
      () => port,
    ),
  ).rejects.toMatchObject({ code: "ORDER_EXPIRED" });
  expect(m.write).not.toHaveBeenCalled();
});
it("keeps an uncertain activation transfer locked until its order is matched", async () => {
  const cfg = standalone(false);
  const api = paymentService(false);
  m.write.mockRejectedValueOnce(Error("Connection lost"));
  await expect(
    startGasFunding(
      cfg,
      provider,
      owner,
      port,
      () => true,
      () => port,
    ),
  ).rejects.toThrow("unknown");
  await expect(
    startGasFunding(
      cfg,
      provider,
      owner,
      port,
      () => true,
      () => port,
    ),
  ).rejects.toMatchObject({ code: "FUNDING_PENDING" });
  expect((await fundingStatus(cfg, owner, 0n, [])).state).toBe("pending");
  api.match();
  expect((await fundingStatus(cfg, owner, 0n, [])).state).toBe("idle");
  expect(m.write).toHaveBeenCalledOnce();
});
it("rejects a standalone activation receipt with the wrong transferred amount", async () => {
  const cfg = standalone(false);
  const api = paymentService(false);
  await startGasFunding(
    cfg,
    provider,
    owner,
    port,
    () => true,
    () => port,
  );
  api.match();
  const receipt = await m.receipt({ hash });
  receipt.logs[0].data = encodeAbiParameters([{ type: "uint256" }], [3000000n]);
  m.receipt.mockResolvedValue(receipt);
  await expect(fundingStatus(cfg, owner, 0n, [])).rejects.toMatchObject({
    code: "FUNDING_MISMATCH",
  });
  expect(loadCreation(creationKey(cfg, owner))).toBeDefined();
});

it("does not clear a newer payment when an old tracking request finishes late", async () => {
  await start();
  let deliver!: (receipt: unknown) => void;
  m.receipt.mockImplementationOnce(async () => ({
    status: "success",
    logs: [
      {
        address: ARBITRUM_USDC,
        topics: encodeEventTopics({
          abi: IERC20ABI,
          eventName: "Transfer",
          args: { from: owner, to: receiver },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [3000000n]),
      },
    ],
  }));
  m.receipt.mockImplementationOnce(
    () =>
      new Promise((r) => {
        deliver = r;
      }),
  );
  const reading = fundingStatus(config, owner, 10000000000000000n, [record]);
  await vi.waitFor(() => expect(deliver).toBeDefined());
  const key = creationKey(config, owner);
  const newer = {
    ...loadCreation(key)!,
    createdAt: Date.now() + 1000,
    hash: targetHash,
  };
  localStorage.setItem(key, JSON.stringify(newer));
  deliver({ status: "success", to: owner });
  await reading;
  expect(loadCreation(key)).toEqual(newer);
});
