import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { mountMockWidget } from "./rpc-fixture";
// Generate the optional read-only reference harness with scripts/build-ui-reference.mjs.
// Production builds and portable tests never require the adjacent repository.
const enabled = process.env.LEVERACC_REFERENCE === "1";
for (const locale of ["en", "zh"])
  for (const width of [375, 1000]) {
    test(`reference screenshots ${locale} ${width}`, async ({
      page,
      context,
    }) => {
      test.skip(
        !enabled,
        "Explicit visual comparison against the adjacent dapp",
      );
      expect(existsSync(".cache/ui-reference/index.html")).toBe(true);
      await page.setViewportSize({ width, height: 1000 });
      const keys = [
        "create",
        "deposit",
        "borrow",
        "repay",
        "transfer",
        "withdraw",
      ];
      const names =
        locale === "en"
          ? [
              "Create Trading Account",
              "Deposit",
              "Borrow",
              "Repay",
              "Transfer",
              "Withdraw",
            ]
          : ["创建交易账户", "充值", "借款", "还款", "划转", "提现"];
      for (let i = 0; i < keys.length; i++) {
        await page.goto(
          `/.cache/ui-reference/index.html?modal=${keys[i]}&locale=${locale}`,
        );
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
          (document.activeElement as HTMLElement)?.blur();
        });
        await page
          .getByRole("dialog")
          .screenshot({
            path: `test-results/reference-${keys[i]}-${locale}-${width}.png`,
          });
        const widgetPage = await context.newPage();
        await widgetPage.setViewportSize({ width, height: 1000 });
        await mountMockWidget(widgetPage, locale, {
          mainnet: true,
          noAccount: i === 0,
        });
        await widgetPage
          .getByRole("button", { name: names[i], exact: true })
          .click();
        await expect(widgetPage.getByRole("dialog")).toBeVisible();
        await widgetPage.evaluate(() => document.fonts.ready);
        await widgetPage
          .getByRole("dialog")
          .screenshot({
            path: `test-results/widget-${keys[i]}-${locale}-${width}.png`,
          });
        await widgetPage.close();
      }
    });
  }
