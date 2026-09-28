import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useWidgetForm } from "../src/ui/useWidgetForm";
import type { WidgetController } from "../src/core/controller";
import type { FundsFeature, Snapshot, OperationRecord } from "../src/types";

it.each<FundsFeature>(["deposit", "withdraw", "transfer", "borrow", "repay"])(
  "%s resets only after final submission and does not clear the next input on refresh",
  async (tab) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let snapshot = {
      status: "ready",
      owner: "owner",
      account: "account",
      reasons: [],
      busy: false,
      balances: {
        evm: 100000000n,
        spot: 100000000n,
        fund: 100000000n,
        debt: 20000000n,
      },
    } as unknown as Snapshot;
    const c = {
      config: {
        locale: "en",
        network: "mainnet",
        projectId: "project",
        features: {
          deposit: true,
          withdraw: true,
          transfer: true,
          borrow: true,
          repay: true,
        },
        chain: {},
      },
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      quoteBridge: vi.fn().mockResolvedValue(100000n),
      quoteArbitrumWithdrawal: vi
        .fn()
        .mockResolvedValue({ maximum: 100000000n }),
      bridgeBalances: vi
        .fn()
        .mockResolvedValue({ balance: 100000000n, allowance: 100000000n }),
      fundSourceBalances: vi
        .fn()
        .mockResolvedValue({
          core: 100000000n,
          fund: 100000000n,
          allowance: 100000000n,
        }),
    } as unknown as WidgetController;
    let model!: ReturnType<typeof useWidgetForm>;
    function Form() {
      model = useWidgetForm(c);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = () => act(async () => root.render(<Form />));
    const operation = (stage: OperationRecord["stage"], extra = {}) =>
      ({ id: "transaction", action: tab, stage, ...extra }) as OperationRecord;
    try {
      await render();
      await act(async () => {
        model.setTab(tab);
        model.setAmount("10");
        if (tab === "withdraw") model.setRoute("fundToArbitrum");
        model.setFull(tab === "repay");
      });
      const route = model.route;
      snapshot = {
        ...snapshot,
        operation: operation("submitted", {
          id: "approval",
          action: "bridgeApproval",
        }),
      };
      await render();
      expect(model.amount).toBe("10");
      snapshot = {
        ...snapshot,
        operation: operation("failed", { error: "Cancelled" }),
      };
      await render();
      expect(model.amount).toBe("10");
      snapshot = {
        ...snapshot,
        operation: operation("awaitingAction"),
        continuation: operation("awaitingAction"),
      };
      await render();
      expect(model.amount).toBe("10");
      snapshot = {
        ...snapshot,
        busy: true,
        operation: operation("submitted"),
        continuation: undefined,
      };
      await render();
      expect(model.amount).toBe("10");
      snapshot = { ...snapshot, busy: false };
      await render();
      expect(model.amount).toBe("");
      expect(model.full).toBe(false);
      expect(model.route).toBe(route);
      await act(async () => model.setAmount("5"));
      snapshot = {
        ...snapshot,
        operation: { ...snapshot.operation! },
        balances: { ...snapshot.balances! },
      };
      await render();
      expect(model.amount).toBe("5");
    } finally {
      await act(async () => root.unmount());
    }
  },
);
