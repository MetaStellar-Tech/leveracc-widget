import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreateAccountForm } from "../src/ui/CreateAccountForm";
import { en } from "../src/ui/strings";
import type { WidgetController } from "../src/core/controller";
import type { Snapshot } from "../src/types";
let root: Root, container: HTMLDivElement;
const ready = { gas: 10000000000000000n, hasTopUp: true, ready: true };
const check = vi.fn();
const c = {
  config: {
    network: "testnet",
    projectId: "project",
    rpcUrl: "rpc",
    protocolServiceUrl: "service",
  },
  creationReadiness: check,
  refresh: vi.fn(),
  hasGasTopUp: true,
  topUpGas: vi.fn(),
  createAccount: vi.fn(),
} as unknown as WidgetController;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  check.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
async function render(owner = "0x1111111111111111111111111111111111111111") {
  await act(async () =>
    root.render(
      <CreateAccountForm
        controller={c}
        s={{ owner, status: "noAccount", busy: false, reasons: [] } as Snapshot}
        t={en}
        onDone={() => {}}
      />,
    ),
  );
}
function createButton() {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent === en.signCreate,
  );
}
it("ignores an old owner's late response", async () => {
  let resolve!: (value: typeof ready) => void;
  check
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ ...ready, hasTopUp: false, ready: false });
  await render();
  await render("0x2222222222222222222222222222222222222222");
  await act(async () => resolve(ready));
  expect(createButton()).toBeUndefined();
});
it("recovers automatically after a failed read without a refresh button", async () => {
  check
    .mockRejectedValueOnce(new Error("Service unavailable"))
    .mockResolvedValue(ready);
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Service unavailable",
  );
  expect(container.textContent).not.toContain(en.refreshStatus);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(createButton()?.disabled).toBe(false);
});
it("does not overlap a slow readiness request", async () => {
  let resolve!: (value: typeof ready) => void;
  check
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ ...ready, hasTopUp: false, ready: false });
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => resolve(ready));
  expect(createButton()?.disabled).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(check).toHaveBeenCalledTimes(1);
  expect(createButton()?.disabled).toBe(false);
});
it("polls a low balance and stops when creation is available", async () => {
  check
    .mockResolvedValueOnce({ ...ready, ready: false })
    .mockResolvedValue(ready);
  await render();
  expect(createButton()).toBeUndefined();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(check).toHaveBeenCalledTimes(2);
  expect(createButton()?.disabled).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(check).toHaveBeenCalledTimes(2);
  expect(c.createAccount).not.toHaveBeenCalled();
});

it("rechecks on opt-out changes and discards the old response", async () => {
  c.config.skipCreationTopUpCheck = false;
  let resolve!: (value: typeof ready) => void;
  check
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ ...ready, hasTopUp: false });
  await render();
  c.config.skipCreationTopUpCheck = true;
  await render();
  expect(createButton()?.disabled).toBe(false);
  await act(async () => resolve({ ...ready, ready: false }));
  expect(createButton()?.disabled).toBe(false);
  c.config.skipCreationTopUpCheck = false;
  check.mockResolvedValue({ ...ready, hasTopUp: false, ready: false });
  await render();
  expect(createButton()).toBeUndefined();
});
