import { test, expect } from "@playwright/test";
import { mountMockWidget, projectId } from "./rpc-fixture";

const config = {
  network: "testnet",
  projectId,
  rpcUrl: "https://api.example.test/rpc",
  arbitrumRpcUrl: "https://api.example.test/arbitrum",
  arbitrumWithdrawalEnabled: true,
};
test("embed colors reach dialogs, keep inputs, reset overrides and isolate instances", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.getByRole("button", { name: "Borrow", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  await page.evaluate((config) => {
    (window as any).testWidget.update({
      config: {
        ...config,
        theme: "light",
        colors: {
          primary: "#7438cc",
          surface: "#faf7ff",
          background: "#eeeaff",
          text: "#123456",
          textMuted: "#567890",
          border: "#aabbcc",
          onPrimary: "#ffffaa",
          sliderTrack: "#102030",
          overlay: "#204060",
          shadow: "#406080",
          danger: "#aa2244",
        },
      },
    });
    const element = document.createElement("div");
    element.id = "second-widget";
    document.body.append(element);
    (window as any).secondWidget = (window as any).LeverAcc.mountLeverAccWidget(
      element,
      { config },
    );
  }, config);
  const first = page.locator("#test-widget");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue("10");
  await expect(first.locator(".widget")).toHaveCSS(
    "background-color",
    "rgb(250, 247, 255)",
  );
  await expect(first.locator(".widget")).toHaveCSS(
    "border-top-color",
    "rgb(170, 187, 204)",
  );
  await expect(dialog).toHaveCSS("background-color", "rgb(238, 234, 255)");
  await expect(dialog).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(dialog.locator(".primary")).toHaveCSS(
    "background-color",
    "rgb(116, 56, 204)",
  );
  await expect(dialog.locator(".primary")).toHaveCSS(
    "color",
    "rgb(255, 255, 170)",
  );
  await expect(dialog.locator(".borrow-slider")).toHaveCSS(
    "background-image",
    /rgb\(16, 32, 48\)/,
  );
  await expect(first.locator(".borrowed dd")).toHaveCSS(
    "color",
    "rgb(170, 34, 68)",
  );
  await expect(page.locator(".modal-backdrop")).toHaveCSS(
    "background-color",
    "color(srgb 0.12549 0.25098 0.376471 / 0.5)",
  );
  await expect(dialog).toHaveCSS("box-shadow", /0.25098 0.376471 0.501961/);
  await expect(page.locator("#second-widget .widget")).toHaveCSS(
    "background-color",
    "rgb(23, 26, 32)",
  );
  await page.evaluate(
    (config) => (window as any).testWidget.update({ config }),
    config,
  );
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue("10");
  await expect(dialog.locator(".primary")).toHaveCSS(
    "background-color",
    "rgb(0, 153, 255)",
  );
});

test("creation warning and info use semantic colors", async ({ page }) => {
  await mountMockWidget(page, "en", { noAccount: true, noTopUp: true });
  await page.evaluate(
    (config) =>
      (window as any).testWidget.update({
        config: {
          ...config,
          colors: {
            warning: "#ab3412",
            onWarning: "#fedcba",
            info: "#1234ab",
            badgeText: "#abcdef",
          },
        },
      }),
    config,
  );
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".creation-gas-submit")).toHaveCSS(
    "background-color",
    "rgb(171, 52, 18)",
  );
  await expect(dialog.locator(".creation-gas-submit")).toHaveCSS(
    "color",
    "rgb(254, 220, 186)",
  );
  await expect(dialog.locator(".creation-gas-info")).toHaveCSS(
    "color",
    "rgb(18, 52, 171)",
  );
  await expect(dialog.locator(".step-badge").first()).toHaveCSS(
    "color",
    "rgb(171, 205, 239)",
  );
});

test("repayment uses configured debt color and leaves completion feedback to the host", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.evaluate(
    (config) =>
      (window as any).testWidget.update({
        config: {
          ...config,
          colors: { debt: "#ab1234", success: "#127856" },
        },
      }),
    config,
  );
  await page.getByRole("button", { name: "Repay", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".repay-current .text-button span")).toHaveCSS(
    "color",
    "rgb(171, 18, 52)",
  );
  await dialog.getByRole("textbox").fill("10");
  await dialog.getByRole("button", { name: "Repay", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).events.some(
            (event: any) => event.type === "operationSubmitted",
          ),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  await expect(page.locator(".operation")).toHaveCount(0);
});

for (const integration of ["react", "vanilla"]) {
  test(`${integration} example switches every preset including light and dark`, async ({
    page,
  }) => {
    await page.goto(`/examples-dist/examples/${integration}/`);
    const widget = page.locator(".widget");
    for (const [name, scheme, surface, primary, onPrimary] of [
      [
        "light",
        "light",
        "rgb(255, 255, 255)",
        "rgb(0, 153, 255)",
        "rgb(255, 255, 255)",
      ],
      [
        "midnight",
        "dark",
        "rgb(15, 23, 42)",
        "rgb(96, 165, 250)",
        "rgb(15, 23, 42)",
      ],
      [
        "lavender",
        "light",
        "rgb(250, 247, 255)",
        "rgb(116, 56, 204)",
        "rgb(255, 255, 255)",
      ],
      [
        "dark",
        "dark",
        "rgb(23, 26, 32)",
        "rgb(0, 153, 255)",
        "rgb(255, 255, 255)",
      ],
    ]) {
      await page.getByLabel("Widget theme", { exact: true }).selectOption(name);
      await expect(widget).toHaveCSS("color-scheme", scheme);
      await expect(widget).toHaveCSS("background-color", surface);
      await expect(widget.locator(".primary")).toHaveCSS(
        "background-color",
        primary,
      );
      await expect(widget.locator(".primary")).toHaveCSS("color", onPrimary);
    }
  });
}
