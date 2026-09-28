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
    expect(Number(debt)).toBeGreaterThan(0);
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
