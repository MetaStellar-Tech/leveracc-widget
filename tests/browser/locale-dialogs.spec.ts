import { test, expect } from "@playwright/test";
import { mountMockWidget, projectId } from "./rpc-fixture";

const config = {
  network: "testnet",
  rpcUrl: "https://api.example.test/rpc",
  arbitrumRpcUrl: "https://api.example.test/arbitrum",
  arbitrumWithdrawalEnabled: true,
  projectId,
  borrow: { termSeconds: 86400, maxCoreReturnFeeUsdc: "0.25" },
};

for (const locale of ["en", "zh"]) {
  test(`${locale}: borrow copy and live locale update preserve amount and signing`, async ({
    page,
  }) => {
    await mountMockWidget(page, locale);
    await page.evaluate(
      (config) => (window as any).testWidget.update({ config }),
      { ...config, locale },
    );
    await page
      .getByRole("button", {
        name: locale === "en" ? "Borrow" : "借款",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("10");
    await expect(dialog.locator(".borrow-terms .meta")).toHaveCount(1);
    await expect(dialog.locator(".borrow-terms")).toContainText(
      locale === "en" ? "Current daily rate" : "当前日利率",
    );
    const next = locale === "en" ? "zh" : "en";
    await page.evaluate(
      (config) => (window as any).testWidget.update({ config }),
      { ...config, locale: next },
    );
    await expect(dialog).toHaveAccessibleName(
      next === "en" ? "Quick Borrow" : "快速借入",
    );
    await expect(dialog.getByRole("textbox")).toHaveValue("10");
    await expect(dialog.locator(".borrow-terms")).toContainText(
      next === "en" ? "Current daily rate" : "当前日利率",
    );
    await dialog.locator(".primary").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).requests.filter(
              (r: any) => r.method === "eth_signTypedData_v4",
            ).length,
        ),
      )
      .toBeGreaterThan(0);
    const intent = await page.evaluate(() =>
      JSON.parse(
        (window as any).requests.find(
          (r: any) => r.method === "eth_signTypedData_v4",
        ).params[1],
      ),
    );
    expect(Number(intent.message.termSeconds)).toBe(86400);
    expect(intent.message.maxCoreReturnFee).toBe("250000");
  });

  test(`${locale}: withdrawal to transfer never opens layer routes`, async ({
    page,
  }) => {
    await mountMockWidget(page, locale);
    await page
      .getByRole("button", {
        name: locale === "en" ? "Withdraw" : "提现",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".notice, .note")).toHaveCount(0);
    await expect(dialog.getByRole("textbox")).toBeEnabled();
    await expect(dialog.locator(".primary")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", {
        name: locale === "en" ? "Transfer" : "划转",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await expect(dialog.locator(".funds-card").first()).toContainText(
      locale === "en" ? "Fund Account" : "资金账户",
    );
    await dialog
      .getByRole("button", {
        name: locale === "en" ? "Reverse direction" : "切换方向",
      })
      .click();
    await expect(dialog.locator(".funds-card").first()).toContainText(
      locale === "en" ? "Trade Account" : "交易账户",
    );
    await dialog.getByRole("textbox").fill("12");
    const next = locale === "en" ? "zh" : "en";
    await page.evaluate(
      (config) => (window as any).testWidget.update({ config }),
      { ...config, locale: next },
    );
    await expect(dialog).toHaveAccessibleName(
      next === "en" ? "Account Transfer" : "账户转账",
    );
    await expect(dialog.getByRole("textbox")).toHaveValue("12");
    await expect(dialog.locator(".funds-card").first()).toContainText(
      next === "en" ? "Trade Account" : "交易账户",
    );
  });
}

for (const locale of ["en", "zh"]) {
  test(`${locale}: disabled deployment hides withdrawal notes but still blocks submission`, async ({
    page,
  }) => {
    await mountMockWidget(page, locale, { mainnet: true });
    await page.evaluate(
      (config) => (window as any).testWidget.update({ config }),
      {
        ...config,
        network: "mainnet",
        locale,
        arbitrumWithdrawalEnabled: false,
      },
    );
    await page
      .getByRole("button", {
        name: locale === "en" ? "Withdraw" : "提现",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("10");
    await expect(dialog.locator(".notice, .note")).toHaveCount(0);
    await expect(dialog.locator(".primary")).toBeDisabled();
  });
}

test("pending transfer survives language update and reopening with its direction intact", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  await dialog.locator(".primary").click();
  await expect(
    dialog.getByRole("button", { name: "Continue transfer", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  const saved = await page.evaluate(() =>
    Object.values(localStorage).find((v) => v.includes('"transferFlow"')),
  );
  expect(saved).toBeUndefined();
  await page.evaluate(
    (config) => (window as any).testWidget.update({ config }),
    { ...config, locale: "zh" },
  );
  await expect(dialog).toHaveAccessibleName("账户转账");
  await expect(dialog.getByRole("textbox")).toHaveValue("10");
  await expect(
    dialog.getByRole("button", { name: "继续划转", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).find((v) => v.includes('"transferFlow"')),
    ),
  ).toBe(saved);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "划转", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("10");
  await expect(dialog.locator(".funds-card").first()).toContainText("资金账户");
  await expect(dialog.getByRole("button", { name: "切换方向" })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "继续划转", exact: true }),
  ).toBeEnabled();
});
