import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useWidgetForm } from "../src/ui/useWidgetForm";
import type { WidgetController } from "../src/core/controller";

it("limits withdrawal reads to the visible form and selected source", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  let snapshot = {
    status: "ready",
    owner: "owner",
    reasons: [],
    busy: false,
    balanceRevision: 0,
    operation: undefined as
      { id: string; action: string; stage: string } | undefined,
    balances: { evm: 100n, spot: 200n, debt: 0n, fund: 300n },
  };
  const quoteArbitrumWithdrawal = vi.fn().mockResolvedValue({ maximum: 100n });
  const fundSourceBalances = vi
    .fn()
    .mockResolvedValue({ core: 200n, fund: 7000000n, allowance: 0n });
  const bridgeBalances = vi
    .fn()
    .mockResolvedValue({ balance: 30000000n, allowance: 15000000n });
  const controller = {
    config: {
      network: "mainnet",
      projectId: "project",
      features: { borrow: true, withdraw: true, deposit: true },
      chain: {},
    },
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    quoteArbitrumWithdrawal,
    fundSourceBalances,
    bridgeBalances,
    quoteBridge: vi.fn().mockResolvedValue(1n),
  } as unknown as WidgetController;
  let model!: ReturnType<typeof useWidgetForm>;
  function Form({ active }: { active: boolean }) {
    model = useWidgetForm(controller, active);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async (active: boolean) => {
    await act(async () => root.render(<Form active={active} />));
  };
  try {
    await render(false);
    await act(async () => {
      model.setTab("withdraw");
      model.setRoute("tradeToArbitrum");
    });
    expect(quoteArbitrumWithdrawal).not.toHaveBeenCalled();
    await render(true);
    expect(quoteArbitrumWithdrawal).toHaveBeenCalledTimes(1);
    expect(bridgeBalances).toHaveBeenCalledTimes(1);
    expect(fundSourceBalances).not.toHaveBeenCalled();
    snapshot = { ...snapshot, balances: { ...snapshot.balances } };
    await render(true);
    expect(quoteArbitrumWithdrawal).toHaveBeenCalledTimes(1);
    await act(async () => model.setRoute("fundToArbitrum"));
    expect(fundSourceBalances).toHaveBeenCalledTimes(1);
    expect(model.available).toBe(7000000n);
    await render(false);
    snapshot = { ...snapshot, balances: { ...snapshot.balances, fund: 400n } };
    await render(false);
    expect(fundSourceBalances).toHaveBeenCalledTimes(1);
    await render(true);
    expect(fundSourceBalances).toHaveBeenCalledTimes(2);
    await act(async () => {
      model.setTab("deposit");
      model.setDepositRoute("arbitrum");
    });
    const balanceReads = bridgeBalances.mock.calls.length;
    await act(async () => model.setAmount("10"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(model.approved).toBe(true);
    await act(async () => model.setAmount("20"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(model.approved).toBe(false);
    expect(bridgeBalances).toHaveBeenCalledTimes(balanceReads);
    expect(fundSourceBalances).toHaveBeenCalledTimes(2);

    let finishApprovalRead!: (value: {
      balance: bigint;
      allowance: bigint;
    }) => void;
    bridgeBalances.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishApprovalRead = resolve;
        }),
    );
    snapshot = {
      ...snapshot,
      operation: {
        id: "deposit-approval",
        action: "bridgeApproval",
        stage: "submitted",
      },
    };
    await render(true);
    expect(bridgeBalances).toHaveBeenCalledTimes(balanceReads + 1);
    expect(model.arbitrumBalance).toBe(30000000n);
    expect(model.balanceLoading).toBe(false);
    expect(model.approved).toBe(false);
    await act(async () =>
      finishApprovalRead({ balance: 30000000n, allowance: 25000000n }),
    );
    expect(model.approved).toBe(true);

    await act(async () => {
      model.setTab("withdraw");
      model.setRoute("fundToArbitrum");
    });
    expect(model.approved).toBe(false);
    const fundReads = fundSourceBalances.mock.calls.length;
    fundSourceBalances.mockResolvedValue({
      core: 200n,
      fund: 9000000n,
      allowance: 25000000n,
    });
    snapshot = {
      ...snapshot,
      operation: {
        id: "withdraw-approval",
        action: "bridgeApproval",
        stage: "submitted",
      },
    };
    await render(true);
    expect(fundSourceBalances).toHaveBeenCalledTimes(fundReads + 1);
    expect(model.approved).toBe(true);
    expect(model.available).toBe(9000000n);

    // An explicit account refresh must update Arbitrum even when local balances do not change.
    bridgeBalances.mockResolvedValue({ balance: 42000000n });
    snapshot = { ...snapshot, balanceRevision: 1 };
    await render(true);
    expect(model.arbitrumBalance).toBe(42000000n);

    fundSourceBalances.mockResolvedValue({
      fund: 12000000n,
      allowance: 25000000n,
    });
    bridgeBalances.mockResolvedValue({ balance: 51000000n });
    await act(async () => model.refreshBalances());
    expect(model.available).toBe(12000000n);
    expect(model.arbitrumBalance).toBe(51000000n);

    bridgeBalances.mockRejectedValueOnce(Error("Arbitrum RPC offline"));
    await act(async () => model.refreshBalances());
    expect(model.arbitrumBalance).toBeUndefined();
    expect(model.localError).toBe("Arbitrum RPC offline");
    await act(async () => model.refreshBalances());
    expect(model.arbitrumBalance).toBe(51000000n);
    expect(model.localError).toBeUndefined();

    let finishOld!: (value: { fund: bigint; allowance: bigint }) => void;
    fundSourceBalances.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    await act(async () => model.refreshBalances());
    await act(async () => model.setRoute("tradeToArbitrum"));
    await act(async () => finishOld({ fund: 999000000n, allowance: 0n }));
    expect(model.available).toBe(100n);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it("discards old-account withdrawal reads and clears the maximum on query failure", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let snapshot = {
    status: "ready",
    owner: "owner-a",
    account: "account-a",
    reasons: [],
    busy: false,
    balanceRevision: 0,
  };
  let finishOld!: (value: { maximum: bigint }) => void;
  const quoteArbitrumWithdrawal = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue({ maximum: 24000000n });
  const controller = {
    config: {
      network: "mainnet",
      projectId: "project",
      features: { borrow: true, withdraw: true },
      chain: {},
    },
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    quoteArbitrumWithdrawal,
    bridgeBalances: vi.fn().mockResolvedValue({ balance: 0n, allowance: 0n }),
  } as unknown as WidgetController;
  let model!: ReturnType<typeof useWidgetForm>;
  function Form() {
    model = useWidgetForm(controller, true);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Form />));
    await act(async () => {
      model.setTab("withdraw");
      model.setRoute("tradeToArbitrum");
    });
    expect(model.available).toBeUndefined();
    snapshot = { ...snapshot, owner: "owner-b", account: "account-b" };
    await act(async () => root.render(<Form />));
    expect(model.available).toBe(24000000n);
    await act(async () => finishOld({ maximum: 99000000n }));
    expect(model.available).toBe(24000000n);
    quoteArbitrumWithdrawal.mockRejectedValue(new Error("Core offline"));
    snapshot = { ...snapshot, balanceRevision: 1 };
    await act(async () => root.render(<Form />));
    expect(model.available).toBeUndefined();
    expect(model.invalid).toBe(true);
    expect(model.localError).toBe("Core offline");
  } finally {
    await act(async () => root.unmount());
  }
});
