import { test, expect } from "@playwright/test";
import { mountMockWidget } from "./rpc-fixture";

for (const locale of ["en", "zh"]) {
  test(`${locale}: repay matches Quick Borrow card and validates debt`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await mountMockWidget(page, locale);
    const repay = locale === "en" ? "Repay" : "还款";
    await page.getByRole("button", { name: repay, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const close = dialog.getByRole("button", {
      name: locale === "en" ? "Close" : "关闭",
      exact: true,
    });
    await expect(close).toBeVisible();
    await close.click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: repay, exact: true }).click();
    await expect(dialog.locator(".repay-balance-list .meta")).toHaveCount(4);
    const labels =
      locale === "en"
        ? [
            "Core available",
            "Account EVM",
            "Realtime debt",
            "Available to repay",
          ]
        : ["Core 可用", "账户 EVM", "实时债务", "可还金额"];
    for (const label of labels)
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    await expect(
      dialog.locator(".repayment-summary, .repay-actions"),
    ).toHaveCount(0);
    const submit = dialog.getByRole("button", { name: repay, exact: true });
    await expect(submit).toBeDisabled();
    await dialog.locator(".repay-current button").click();
    const amount = dialog.getByRole("textbox");
    const debt = await amount.inputValue();
    expect(debt).toBe("100.35025");
    await expect(
      dialog.getByText(
        locale === "en"
          ? /Includes a 0.1% interest allowance/
          : /已增加 0.1% 利息预留/,
      ),
    ).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await amount.fill(String(Number(debt) + 1));
    await expect(submit).toBeDisabled();
    for (const invalid of ["0", "-1", "1.1234567"]) {
      await amount.fill(invalid);
      await expect(submit).toBeDisabled();
    }
    await amount.fill("10");
    await expect(submit).toBeEnabled();
    await dialog.screenshot({
      path: `test-results/repay-card-${locale}.png`,
      animations: "disabled",
    });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await submit.click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as any).events.filter(
                (event: any) =>
                  event.type === "operationSubmitted" &&
                  event.action === "repay",
              ).length,
          ),
        { timeout: 20000 },
      )
      .toBe(1);
  });
}

for (const locale of ["en", "zh"]) {
  test(`${locale}: automatically tops up Core and waits before repayment`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await mountMockWidget(page, locale, { repayTopup: true });
    const repay = locale === "en" ? "Repay" : "还款";
    await page.getByRole("button", { name: repay, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".repay-current button").click();
    await expect(
      dialog.locator(".repay-balance-list .meta").first(),
    ).toContainText("59.273703");
    await expect(dialog.getByRole("textbox")).toHaveValue("42.600853");
    await expect(
      dialog.getByRole("button", { name: repay, exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: repay, exact: true }).click();
    await expect(
      dialog.getByRole("button", {
        name: locale === "en" ? "Waiting for EVM funds" : "等待 EVM 到账",
      }),
    ).toBeDisabled();
    await expect(dialog.getByRole("textbox")).toHaveValue("42.600853");
    await expect(dialog.getByRole("textbox")).toBeDisabled();
    const submissions = () =>
      page.evaluate(() =>
        (window as any).events
          .filter(
            (e: any) => e.type === "operationSubmitted" && e.action === "repay",
          )
          .map((e: any) => e.repayStep),
      );
    expect(await submissions()).toEqual(["topup"]);
    await dialog.screenshot({
      path: `test-results/repay-waiting-${locale}.png`,
    });
    await page.evaluate(async () => {
      await (window as any).__accrueRepayInterest("20000");
      await (window as any).__arriveRepayTopup();
    });
    await expect.poll(submissions).toEqual(["topup", "repay"]);
    await expect(dialog.getByRole("textbox")).toHaveValue("");
    await expect(
      dialog.locator(".repay-balance-list .meta").nth(2),
    ).toContainText("0 USDC");
    await expect(
      dialog.locator(".repay-balance-list .meta").nth(1),
    ).toContainText("0.022559 USDC");
    const signed = await page.evaluate(() => {
      const request = (window as any).requests.find(
        (r: any) => r.method === "eth_signTypedData_v4",
      );
      return JSON.parse(request.params[1]).message.requestedRepayAmount;
    });
    expect(BigInt(signed)).toBe(42600853n);
    await dialog.screenshot({ path: `test-results/repay-topup-${locale}.png` });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
}

test("repayment starts fresh after closing and uses the arrived EVM funds", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { repayTopup: true });
  await page.evaluate(() => {
    const wallet = (window as any).testWallet;
    const original = wallet.request;
    wallet.request = async (request: any) => {
      if (request.method === "eth_signTypedData_v4") {
        wallet.request = original;
        throw { code: 4001 };
      }
      return original(request);
    };
  });
  await page.getByRole("button", { name: "Repay", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("42.558294");
  await dialog.getByRole("button", { name: "Repay", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Waiting for EVM funds" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__arriveRepayTopup());
  await expect(
    dialog.getByRole("button", { name: "Retry repayment" }),
  ).toBeEnabled();
  await dialog
    .locator(".modal-header")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Repay", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await dialog.getByRole("textbox").fill("42");
  await dialog.getByRole("button", { name: "Repay", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events
          .filter(
            (e: any) => e.type === "operationSubmitted" && e.action === "repay",
          )
          .map((e: any) => e.repayStep),
      ),
    )
    .toEqual(["topup", "repay"]);
});

for (const locale of ["en", "zh"]) {
  test(`${locale}: closing during repayment top-up stops automatic repayment`, async ({
    page,
  }) => {
    await mountMockWidget(page, locale, { repayTopup: true });
    const name = locale === "en" ? "Repay" : "还款";
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("42");
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect(dialog.locator(".primary")).toHaveText(
      locale === "en" ? "Waiting for EVM funds" : "等待 EVM 到账",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => (window as any).__arriveRepayTopup());
    await page.getByRole("button", { name, exact: true }).click();
    await expect(dialog.getByRole("textbox")).toHaveValue("");
    await expect(dialog.getByRole("textbox")).toBeEnabled();
    await expect(dialog.locator(".primary")).toHaveText(name);
    expect(
      await page.evaluate(() =>
        (window as any).events
          .filter(
            (e: any) => e.type === "operationSubmitted" && e.action === "repay",
          )
          .map((e: any) => e.repayStep),
      ),
    ).toEqual(["topup"]);
  });
}
