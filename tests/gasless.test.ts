import { GaslessServiceError } from "../src/protocol/gasless-service";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { hashTypedData } from "viem";
import { resolveConfig } from "../src/core/config";
import {
  gaslessAmount,
  gaslessLimits,
  validateGaslessQuote,
} from "../src/protocol/gasless-validation";
import { gasConfig, owner, receiver, quoteFixture } from "./gasless-fixtures";
import { executeGasless, gaslessReadiness } from "../src/protocol/gasless";
import { loadGasless, saveGasless } from "../src/protocol/gasless-store";
const h = vi.hoisted(() => ({
  config: vi.fn(),
  funding: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
  route: vi.fn(),
  sign: vi.fn(),
  addresses: vi.fn(),
  chain: vi.fn(),
  signer: vi.fn(),
}));
vi.mock("../src/protocol/gasless-service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getGaslessConfig: h.config,
}));
vi.mock("../src/protocol/gasless-api", () => ({
  prepareGasless: h.prepare,
  submitGasless: h.submit,
  getGaslessStatus: h.status,
}));
vi.mock("../src/protocol/gasless-chain", () => ({
  readGaslessFunding: h.funding,
}));
vi.mock("../src/protocol/gas-funding", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  gasFundingRoute: h.route,
}));
vi.mock("../src/core/wallet", () => ({ signer: h.signer }));
const base = {
  network: "mainnet" as const,
  projectId: `0x${"ab".repeat(32)}` as `0x${string}`,
};
const config = resolveConfig({ ...base, creationGaslessEthEnabled: true });
const provider = { request: vi.fn() };
const signature = `0x${"01".repeat(64)}1b`;
const execute = (c = config, current = () => true) =>
  executeGasless(c, owner, provider, current);
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: vi.fn(async (_key, _options, work) => work({})) },
  });
  h.config.mockResolvedValue(gasConfig);
  h.route.mockResolvedValue({ source: "arbitrum", receiver });
  h.funding.mockResolvedValue({
    eth: 0n,
    usdc: 4000000n,
    required: 100n,
    sufficient: false,
  });
  h.prepare.mockImplementation(async (_c, body) =>
    quoteFixture(body.sell_amount_raw),
  );
  h.submit.mockImplementation(async () => ({
    trade_hash: quoteFixture("1000000").trade_hash,
    quote_token: "updated-token",
  }));
  h.sign.mockResolvedValue(signature);
  h.addresses.mockResolvedValue([owner]);
  h.chain.mockResolvedValue(42161);
  h.signer.mockResolvedValue({
    account: { address: owner },
    signMessage: h.sign,
    signTypedData: h.sign,
    getAddresses: h.addresses,
    getChainId: h.chain,
  });
});
afterEach(() => vi.restoreAllMocks());
it("defaults off with one USDC and validates configuration", () => {
  expect(resolveConfig(base)).toMatchObject({
    creationGaslessEthEnabled: false,
    creationGaslessEthAmountUsdc: "1",
  });
  for (const amount of ["0", "-1", "1e1", "0.0000001", " 1", 1, null]) {
    expect(() =>
      resolveConfig({
        ...base,
        creationGaslessEthAmountUsdc: amount as string,
      }),
    ).toThrow();
  }
  expect(() =>
    resolveConfig({
      ...base,
      creationGaslessEthEnabled: "true" as unknown as boolean,
    }),
  ).toThrow();
});
it("enforces independent service limits and per-flow reserves", () => {
  const limits = gaslessLimits(gasConfig);
  expect(gaslessAmount("1", limits, 4000000n, 3000000n)).toBe(1000000n);
  expect(gaslessAmount("1", limits, 2100000n, 1100000n)).toBe(1000000n);
  expect(() => gaslessAmount("1", limits, 2099999n, 1100000n)).toThrow(
    "reserveInsufficient",
  );
  for (const value of ["0.1", "2.000001", "1e-1", "-1", "0.2000001"])
    expect(() => gaslessAmount(value, limits, 9000000n, 3000000n)).toThrow(
      "amountInvalid",
    );
});
it("writes recovery before submission and honors configured amount", async () => {
  const custom = resolveConfig({
    ...base,
    creationGaslessEthEnabled: true,
    creationGaslessEthAmountUsdc: "0.5",
  });
  h.submit.mockImplementation(async () => {
    expect(loadGasless(custom, owner)?.stage).toBe("submitted");
    return {
      trade_hash: quoteFixture("500000").trade_hash,
      quote_token: "updated-token",
    };
  });
  await execute(custom);
  expect(h.prepare.mock.calls[0][1].sell_amount_raw).toBe("500000");
  expect(loadGasless(custom, owner)).toMatchObject({
    stage: "submitted",
    amount: "500000",
    quote_token: "updated-token",
  });
});
it("reserves the activation-only payment", async () => {
  const activation = resolveConfig({
    ...base,
    creationGaslessEthEnabled: true,
    creationGasConversionEnabled: false,
  });
  h.funding.mockResolvedValue({
    eth: 0n,
    usdc: 2100000n,
    required: 100n,
    sufficient: false,
  });
  await execute(activation);
  expect(h.funding).toHaveBeenCalledWith(activation, owner, receiver, 1100000n);
});
it("preserves uncertain submission and never submits it twice", async () => {
  h.submit.mockRejectedValue(new Error("timeout"));
  await expect(execute()).rejects.toThrow("unknown");
  expect(loadGasless(config, owner)?.stage).toBe("submitted");
  await execute();
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("clears only unsubmitted recovery after rejection", async () => {
  h.sign.mockResolvedValueOnce(signature).mockRejectedValueOnce({ code: 4001 });
  await expect(execute()).rejects.toEqual({ code: 4001 });
  expect(loadGasless(config, owner)).toBeNull();
  expect(h.submit).not.toHaveBeenCalled();
});
it("does not sign when ETH is sufficient", async () => {
  h.funding.mockResolvedValue({ sufficient: true });
  await execute();
  expect(h.sign).not.toHaveBeenCalled();
  expect(h.config).not.toHaveBeenCalled();
});
it("checks context and wallet after signing", async () => {
  let active = true;
  h.sign.mockImplementation(async () => {
    active = false;
    return signature;
  });
  await expect(execute(config, () => active)).rejects.toThrow("ownerMismatch");
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
it("rejects a different wallet and checks reserves again before submit", async () => {
  h.addresses.mockResolvedValue([receiver]);
  await expect(execute()).rejects.toThrow("ownerMismatch");
  expect(h.sign).not.toHaveBeenCalled();
  h.addresses.mockResolvedValue([owner]);
  h.funding
    .mockResolvedValueOnce({
      eth: 0n,
      usdc: 4000000n,
      required: 100n,
      sufficient: false,
    })
    .mockResolvedValue({
      eth: 0n,
      usdc: 3100000n,
      required: 100n,
      sufficient: false,
    });
  await expect(execute()).rejects.toThrow("reserveInsufficient");
  expect(h.submit).not.toHaveBeenCalled();
});
it("fails closed when storage or the cross-tab lock is unavailable", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("blocked");
  });
  await expect(execute()).rejects.toThrow("storageError");
  expect(h.sign).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  await expect(execute()).rejects.toThrow("lockUnavailable");
});
it("does not start while another tab holds the lock", async () => {
  vi.mocked(navigator.locks.request).mockImplementation(
    async (_name: any, _options: any, work: any) => work(null),
  );
  await expect(execute()).rejects.toThrow("inProgress");
  expect(h.sign).not.toHaveBeenCalled();
});
it("validates quote binding, output, expiry and signed hash", () => {
  expect(() =>
    validateGaslessQuote(quoteFixture(), owner, 200000n, 100n),
  ).not.toThrow();
  for (const mutate of [
    (q: ReturnType<typeof quoteFixture>) => {
      q.user_eoa = receiver;
    },
    (q: ReturnType<typeof quoteFixture>) => {
      q.source_chain_id = 1;
    },
    (q: ReturnType<typeof quoteFixture>) => {
      q.sell_amount_raw = "200001";
    },
    (q: ReturnType<typeof quoteFixture>) => {
      q.trade_hash = `0x${"ab".repeat(32)}`;
    },
    (q: ReturnType<typeof quoteFixture>) => {
      q.zeroex_quote.trade.eip712.message.nonce = Number.MAX_SAFE_INTEGER + 1;
    },
    (q: ReturnType<typeof quoteFixture>) => {
      (
        q.zeroex_quote.trade.eip712.message.slippageAndActions as any
      ).recipient = receiver;
      q.trade_hash = hashTypedData(q.zeroex_quote.trade.eip712);
    },
  ]) {
    const q = quoteFixture();
    mutate(q);
    expect(() => validateGaslessQuote(q, owner, 200000n, 100n)).toThrow(
      "quoteInvalid",
    );
  }
  expect(() =>
    validateGaslessQuote(quoteFixture(), owner, 200000n, 1001n),
  ).toThrow("outputInsufficient");
  const expired = quoteFixture();
  expired.expires_at = new Date(0).toISOString();
  expect(() => validateGaslessQuote(expired, owner, 200000n, 100n)).toThrow(
    "quoteExpired",
  );
});
it("restores pending exchange and requires chain arrival before proceeding", async () => {
  await execute();
  const op = loadGasless(config, owner)!;
  h.status.mockResolvedValue({
    trade_hash: op.trade_hash,
    provider: "0x",
    phase: "success",
    terminal: true,
    next_poll_after_seconds: 3,
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    ready: false,
    pending: true,
  });
  h.funding.mockResolvedValue({
    eth: 99n,
    usdc: 4000000n,
    required: 100n,
    sufficient: false,
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    ready: false,
    pending: false,
  });
  h.funding.mockResolvedValue({
    eth: 100n,
    usdc: 3000000n,
    required: 100n,
    sufficient: true,
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    ready: true,
    pending: false,
  });
});
it("allows manual ETH funding even when the exchange service is disabled", async () => {
  h.funding.mockResolvedValue({ sufficient: true });
  h.config.mockRejectedValue(Error("unavailable"));
  expect(await gaslessReadiness(config, owner)).toMatchObject({ ready: true });
  expect(h.config).not.toHaveBeenCalled();
});
it("retains uncertainty and permits retry only after confirmed failure", async () => {
  await execute();
  h.status.mockRejectedValue(Error("offline"));
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    pending: true,
    disabled: true,
  });
  const op = loadGasless(config, owner)!;
  h.status.mockResolvedValue({
    trade_hash: op.trade_hash,
    provider: "0x",
    phase: "failed",
    terminal: true,
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    pending: false,
    disabled: false,
  });
  await execute();
  expect(h.submit).toHaveBeenCalledTimes(2);
});
it("isolates recovery by wallet and service", async () => {
  await execute();
  expect(loadGasless(config, receiver)).toBeNull();
  expect(
    loadGasless(
      resolveConfig({ ...base, protocolServiceUrl: "https://other.test" }),
      owner,
    ),
  ).toBeNull();
  const changedAmount = resolveConfig({
    ...base,
    creationGaslessEthAmountUsdc: "2",
  });
  expect(loadGasless(changedAmount, owner)?.stage).toBe("submitted");
});

it("does not overwrite a newer exchange with an old status response", async () => {
  await execute();
  const old = loadGasless(config, owner)!;
  h.status.mockImplementation(async () => {
    saveGasless(config, owner, {
      ...old,
      createdAt: old.createdAt + 1,
      quote_token: "new-operation",
    });
    return {
      trade_hash: old.trade_hash,
      provider: "0x",
      phase: "failed",
      terminal: true,
    };
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    pending: true,
    disabled: true,
  });
  expect(loadGasless(config, owner)).toMatchObject({
    stage: "submitted",
    quote_token: "new-operation",
  });
});

it("validates and signs the optional permit", async () => {
  const q = quoteFixture("1000000");
  q.zeroex_quote.approval = {
    type: "permit",
    eip712: {
      domain: {
        chainId: 42161,
        verifyingContract: q.sell_token as `0x${string}`,
      },
      types: { Permit: [] },
      primaryType: "Permit",
      message: { owner, spender: receiver },
    },
  };
  h.prepare.mockResolvedValue(q);
  await execute();
  expect(h.sign).toHaveBeenCalledTimes(3);
  expect(h.submit.mock.calls[0][1].approval.signature.signatureType).toBe(2);
  q.zeroex_quote.approval.eip712.message.spender = owner;
  expect(() => validateGaslessQuote(q, owner, 1000000n, 100n)).toThrow(
    "quoteInvalid",
  );
});

it("does not spend USDC if external ETH arrives during signing", async () => {
  h.funding
    .mockResolvedValueOnce({
      eth: 0n,
      usdc: 4000000n,
      required: 100n,
      sufficient: false,
    })
    .mockResolvedValue({
      eth: 100n,
      usdc: 3000000n,
      required: 100n,
      sufficient: true,
    });
  await execute();
  expect(h.sign).toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
  expect(loadGasless(config, owner)).toBeNull();
});

it("retains an expired status credential without claiming recovery or resubmitting", async () => {
  await execute();
  const op = loadGasless(config, owner)!;
  saveGasless(config, owner, { ...op, createdAt: Date.now() - 2 * 86400000 });
  h.status.mockRejectedValue(new GaslessServiceError(401));
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    ready: false,
    pending: true,
    disabled: true,
    autoPoll: false,
    error: "statusUnavailable",
  });
  expect(h.status).toHaveBeenCalledOnce();
  expect(loadGasless(config, owner)?.stage).toBe("submitted");
  await execute();
  expect(h.submit).toHaveBeenCalledTimes(1);
});

it("clears recovery only for a proven local submit preflight rejection", async () => {
  h.submit.mockRejectedValue(new GaslessServiceError(429, 30000, false));
  await expect(execute()).rejects.toThrow("serviceError");
  expect(loadGasless(config, owner)).toBeNull();
  h.submit.mockRejectedValue(new GaslessServiceError(503, 5000));
  await expect(execute()).rejects.toThrow("unknown");
  expect(loadGasless(config, owner)?.stage).toBe("submitted");
});

it.each([401, 403, 404])(
  "pauses automatic status polling on HTTP %s but allows manual recovery",
  async (status) => {
    await execute();
    const op = loadGasless(config, owner)!;
    h.status.mockRejectedValue(new GaslessServiceError(status));
    expect(await gaslessReadiness(config, owner)).toMatchObject({
      pending: true,
      disabled: true,
      autoPoll: false,
    });
    expect(loadGasless(config, owner)?.stage).toBe("submitted");
    h.status.mockResolvedValue({
      trade_hash: op.trade_hash,
      provider: "0x",
      phase: "success",
      terminal: true,
    });
    h.funding.mockResolvedValue({
      eth: 100n,
      usdc: 3000000n,
      required: 100n,
      sufficient: true,
    });
    expect(await gaslessReadiness(config, owner)).toMatchObject({
      ready: true,
      pending: false,
    });
  },
);
it("keeps polling transient status failures and pauses a mismatched trade", async () => {
  await execute();
  h.status.mockRejectedValue(new GaslessServiceError(503, 45000));
  const transient = await gaslessReadiness(config, owner);
  expect(transient.autoPoll).toBeUndefined();
  expect(transient.pollAfter).toBe(45000);
  h.status.mockResolvedValue({
    trade_hash: `0x${"cd".repeat(32)}`,
    provider: "0x",
    phase: "success",
    terminal: true,
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    pending: true,
    autoPoll: false,
    error: "unknown",
  });
});

it("preserves a rotated recovery pair when storage fails after submit acknowledgement", async () => {
  const hash = `0x${"cd".repeat(32)}` as const;
  let storage: ReturnType<typeof vi.spyOn> | undefined;
  h.submit.mockImplementation(async () => {
    storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("storage blocked");
    });
    return { trade_hash: hash, quote_token: "rotated-capability" };
  });
  try {
    await expect(execute()).rejects.toThrow("recoveryStorageError");
    expect(await gaslessReadiness(config, owner)).toMatchObject({
      ready: false,
      disabled: true,
      error: "recoveryStorageError",
    });
    await expect(execute()).rejects.toThrow("recoveryStorageError");
    expect(h.submit).toHaveBeenCalledOnce();
  } finally {
    storage?.mockRestore();
  }
  expect(loadGasless(config, owner)).toMatchObject({
    trade_hash: hash,
    quote_token: "rotated-capability",
    stage: "submitted",
  });
  h.status.mockResolvedValue({
    trade_hash: hash,
    provider: "0x",
    phase: "success",
    terminal: true,
  });
  h.funding.mockResolvedValue({
    eth: 100n,
    usdc: 3000000n,
    required: 100n,
    sufficient: true,
  });
  expect(await gaslessReadiness(config, owner)).toMatchObject({
    ready: true,
    pending: false,
  });
  expect(h.status).toHaveBeenCalledWith(
    config,
    expect.objectContaining({
      trade_hash: hash,
      quote_token: "rotated-capability",
    }),
  );
});

it("exposes the verified minimum output before requesting trade signatures", async () => {
  const onQuote = vi.fn();
  await executeGasless(config, owner, provider, () => true, onQuote);
  expect(onQuote).toHaveBeenCalledWith(quoteFixture().min_buy_amount_raw);
  expect(onQuote.mock.invocationCallOrder[0]).toBeLessThan(
    h.sign.mock.invocationCallOrder[1],
  );
});
