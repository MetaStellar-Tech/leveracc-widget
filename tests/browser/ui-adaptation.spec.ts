import { test, expect } from "@playwright/test";
import { mountMockWidget, projectId } from "./rpc-fixture";
for (const width of [240, 320, 375, 480, 720, 960])
  for (const locale of ["en", "zh"]) {
    test(`container ${width} ${locale}: every modal fits a short viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1100, height: 540 });
      await mountMockWidget(page, locale, { mainnet: true });
      await page.locator("main").evaluate((el) => {
        el.style.maxWidth = "none";
      });
      await page.locator("#test-widget").evaluate((el, w) => {
        (el as HTMLElement).style.width = `${w}px`;
      }, width);
      const names =
        locale === "en"
          ? ["Deposit", "Borrow", "Repay", "Transfer", "Withdraw"]
          : ["充值", "借款", "还款", "划转", "提现"];
      await expect(page.locator(".widget")).toBeVisible();
      expect(
        await page
          .locator(".widget")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      for (const name of names) {
        await page.getByRole("button", { name, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        const box = await dialog.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(508);
        expect(box!.y).toBeGreaterThanOrEqual(15);
        await page.keyboard.press("Escape");
      }
    });
  }
test("Fund withdrawal approves then burns on HyperEVM and ends when submitted", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  const dialog = page.getByRole("dialog");
  const cards = dialog.locator(".funds-card");
  const from = (await cards.nth(0).boundingBox())!;
  const to = (await cards.nth(1).boundingBox())!;
  const arrow = (await dialog
    .locator(".route-switch .reverse-route")
    .boundingBox())!;
  expect(
    Math.abs(arrow.y + arrow.height / 2 - (from.y + from.height + to.y) / 2),
  ).toBeLessThan(1);
  await dialog
    .getByRole("button", { name: "Approve USDC", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Withdraw", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).events.filter(
          (e: any) =>
            e.type === "operationSubmitted" && e.action === "withdraw",
        ).length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events.some(
          (event: any) =>
            event.type === "operationSubmitted" && event.action === "withdraw",
        ),
      ),
    )
    .toBe(true);
  await expect(dialog.locator(".operation")).toHaveCount(0);
  await expect(dialog).not.toContainText("Transaction submitted");
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("leveracc:widget:"),
      ),
    ),
  ).toEqual([]);
  expect(await page.getByLabel("Withdrawal source").isDisabled()).toBe(false);
});
test("Trade withdrawal moves Core funds first and resumes the bridge without a second top-up", async ({
  page,
}) => {
  test.setTimeout(40000);
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("800");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue withdrawal", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  expect(
    await page.evaluate(
      () =>
        (window as any).requests.filter(
          (r: any) => r.method === "eth_sendTransaction",
        ).length,
    ),
  ).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).events.filter(
            (event: any) =>
              event.type === "operationSubmitted" &&
              event.action === "withdraw",
          ).length,
      ),
    )
    .toBe(2);
  await expect(page.getByRole("dialog").locator(".operation")).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toContainText(
    "Transaction submitted",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).requests.filter(
          (r: any) => r.method === "eth_sendTransaction",
        ).length,
    ),
  ).toBe(2);
});
test("increased Fund bridge fee requires another click after showing the new quote", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  const approve = page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve USDC", exact: true });
  await expect(approve).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__bridgeFee = "200000";
  });
  await approve.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events.some(
          (event: any) =>
            event.type === "error" &&
            /Bridge fee increased/.test(event.message),
        ),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("dialog").getByText(/Bridge fee increased/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).requests.filter(
          (r: any) => r.method === "eth_sendTransaction",
        ).length,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("dialog").locator(".funds-estimates"),
  ).toContainText("0.2 USDC");
  await expect(approve).toBeEnabled();
});
test("custom theme reaches modal controls and borrowed ratio includes zero", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.evaluate(
    (config) => (window as any).testWidget.update({ config }),
    {
      network: "testnet",
      projectId,
      rpcUrl: "https://api.example.test/rpc",
      theme: "light",
      primaryColor: "#7438cc",
    },
  );
  await page.getByRole("button", { name: "Borrow", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".primary")).toHaveCSS(
    "background-color",
    "rgb(116, 56, 204)",
  );
  await dialog.getByRole("button", { name: "0%", exact: true }).click();
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
    "0.000000",
  );
  await expect(dialog.locator(".primary")).toBeDisabled();
});

test("source selector supports keyboard choice and Escape closes only the menu", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const select = page.getByRole("combobox", { name: "Withdrawal source" });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(select).toContainText("Fund Account");
  await expect(select).toBeFocused();
});
test("account dialog exclusive transfer shortcut is removed", async ({
  page,
}) => {
  await mountMockWidget(page);
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Other account transfers", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator(".funds-card").first(),
  ).toContainText("Fund");
});

for (const width of [280, 320, 375, 480, 768, 1440]) {
  test(`viewport ${width}: account, creation and dialogs remain usable`, async ({
    page,
    context,
  }) => {
    const locale =
      width === 320 || width === 480 || width === 1440 ? "zh" : "en";
    await page.setViewportSize({ width, height: 720 });
    await mountMockWidget(page, locale, { mainnet: true });
    await page.locator("main").evaluate((el) => {
      el.style.maxWidth = "none";
    });
    await expect(page.locator(".account-identity")).toBeVisible();
    for (const selector of [
      ".widget",
      ".header",
      ".account-board",
      ".account-metrics",
      ".entry-actions",
    ]) {
      expect(
        await page
          .locator(selector)
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    const widgetBox = await page.locator(".widget").boundingBox();
    expect(widgetBox!.width).toBeLessThanOrEqual(Math.min(width, 720));
    expect(widgetBox!.x).toBeGreaterThanOrEqual(0);
    expect(widgetBox!.x + widgetBox!.width).toBeLessThanOrEqual(width);
    await page
      .locator(".widget")
      .screenshot({ path: `test-results/responsive-account-${width}.png` });
    const info = page.getByRole("button", {
      name: locale === "en" ? "Collateral breakdown" : "抵押品金额分布",
    });
    await info.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const tooltipBox = await page.getByRole("tooltip").boundingBox();
    expect(tooltipBox!.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    for (const name of locale === "en"
      ? ["Deposit", "Borrow", "Repay", "Transfer", "Withdraw"]
      : ["充值", "借款", "还款", "划转", "提现"]) {
      await page.getByRole("button", { name, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      for (const card of await dialog.locator(".funds-card").all()) {
        expect(
          await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(720);
      if (name === "Deposit" || name === "充值")
        await dialog.screenshot({
          path: `test-results/responsive-deposit-${width}.png`,
        });
      await page.keyboard.press("Escape");
    }
    // Large balances must remain readable instead of clipping at a breakpoint.
    await page.locator(".account-metrics dd").evaluateAll((elements) =>
      elements.forEach((el) => {
        el.textContent = "123456789012.123456 USDC";
      }),
    );
    for (const metric of await page.locator(".account-metrics dd").all()) {
      expect(
        await metric.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    const creation = await context.newPage();
    await creation.setViewportSize({ width, height: 720 });
    await mountMockWidget(creation, locale, { noAccount: true, lowGas: true });
    await creation.locator("main").evaluate((el) => {
      el.style.maxWidth = "none";
    });
    await expect(creation.locator(".onboarding")).toBeVisible();
    expect(
      await creation
        .locator(".widget")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await creation
      .locator(".widget")
      .screenshot({ path: `test-results/responsive-create-${width}.png` });
    await creation
      .getByRole("button", {
        name: locale === "en" ? "Create Trading Account" : "创建交易账户",
        exact: true,
      })
      .click();
    await expect(creation.getByRole("dialog")).toBeVisible();
    expect(
      await creation
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await expect(creation.locator(".creation-gas-submit")).toBeEnabled();
    await creation
      .getByRole("dialog")
      .screenshot({ path: `test-results/creation-gas-${width}.png` });
    await creation.close();
  });
}
