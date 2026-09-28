import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ErrorToast } from "../src/ui/ErrorToast";

it("expires after five seconds despite rerenders and gives new failures a fresh timer", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (key: string) =>
    act(async () =>
      root.render(
        <ErrorToast key={key} closeLabel="Dismiss">
          Request declined
        </ErrorToast>,
      ),
    );
  try {
    await render("first");
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    await render("first");
    expect(container.textContent).toContain("Request declined");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector(".error-toast")).toBeNull();
    await render("second");
    expect(container.textContent).toContain("Request declined");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector(".error-toast")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
