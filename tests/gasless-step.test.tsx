import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GaslessEthStep } from "../src/ui/GaslessEthStep";
import { resolveConfig } from "../src/core/config";
import type { WidgetController } from "../src/core/controller";
it("keeps the signing context active in StrictMode and cancels it on unmount", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let active!: () => boolean;
  const controller = {
    config: resolveConfig({
      network: "mainnet",
      projectId: `0x${"ab".repeat(32)}`,
      creationGaslessEthEnabled: true,
    }),
    getSnapshot: () => ({
      owner: "0x1111111111111111111111111111111111111111",
    }),
    exchangeCreationEth: vi.fn(async (current: () => boolean) => {
      active = current;
      expect(current()).toBe(true);
    }),
  } as unknown as WidgetController;
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <GaslessEthStep
            controller={controller}
            state={{
              ready: false,
              pending: false,
              disabled: false,
              pollAfter: 10000,
            }}
            busy={false}
            onRefresh={async () => {}}
          />
        </StrictMode>,
      ),
    );
    await act(async () =>
      element.querySelector<HTMLButtonElement>("button.primary")!.click(),
    );
    expect(controller.exchangeCreationEth).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
  expect(active()).toBe(false);
});

it("shows a paused status warning instead of a stale submission error", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const controller = {
    config: resolveConfig({
      network: "mainnet",
      projectId: `0x${"ab".repeat(32)}`,
      creationGaslessEthEnabled: true,
    }),
    getSnapshot: () => ({
      owner: "0x1111111111111111111111111111111111111111",
    }),
    exchangeCreationEth: vi.fn(async () => {
      throw Error("timeout");
    }),
  } as unknown as WidgetController;
  const render = async (paused: boolean) =>
    act(async () =>
      root.render(
        <GaslessEthStep
          controller={controller}
          state={{
            ready: false,
            pending: paused,
            disabled: paused,
            pollAfter: 10000,
            ...(paused
              ? { autoPoll: false as const, error: "statusUnavailable" }
              : {}),
          }}
          busy={false}
          onRefresh={async () => {}}
        />,
      ),
    );
  try {
    await render(false);
    await act(async () =>
      element.querySelector<HTMLButtonElement>("button.primary")!.click(),
    );
    expect(element.textContent).toContain("Unable to complete the request");
    await render(true);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      "status credential may have expired",
    );
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

it("shows the quote and clears a submission warning after a confirmed failure", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement("div");
  const root = createRoot(element);
  const controller = {
    config: resolveConfig({
      network: "mainnet",
      projectId: `0x${"ab".repeat(32)}`,
      creationGaslessEthEnabled: true,
    }),
    getSnapshot: () => ({
      owner: "0x1111111111111111111111111111111111111111",
    }),
    exchangeCreationEth: vi.fn(async (_active, onQuote) => {
      onQuote("100000000000000");
      throw Error("timeout");
    }),
  } as unknown as WidgetController;
  const render = async (pending: boolean, error?: string) =>
    act(async () =>
      root.render(
        <GaslessEthStep
          controller={controller}
          state={{
            ready: false,
            pending,
            disabled: pending,
            pollAfter: 3000,
            error,
          }}
          busy={false}
          onRefresh={async () => {}}
        />,
      ),
    );
  try {
    await render(false);
    await act(async () =>
      element.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(element.textContent).toContain("Quoted minimum: 0.0001 ETH");
    await render(true);
    await render(false, "failed");
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "The exchange failed. You can retry.",
    );
    expect(element.querySelectorAll("button")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});
