import { test, expect } from "@playwright/test";
import { mountMockWidget } from "./rpc-fixture";

for (const locale of ["en", "zh"]) {
  test(`${locale}: approval automatically advances to Fund-to-Trade deposit`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await mountMockWidget(page, locale);
    const name = locale === "en" ? "Transfer" : "划转";
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("10");
    await dialog.locator(".primary").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).events.filter(
              (e: any) =>
                e.type === "operationSubmitted" && e.action === "transfer",
            ).length,
        ),
      )
      .toBe(2);
    await expect(dialog.getByRole("textbox")).toHaveValue("");
    await expect(dialog.locator(".primary")).toBeDisabled();
  });
  test(`${locale}: Core-to-EVM transfer waits then automatically withdraws`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await mountMockWidget(page, locale, { repayTopup: true });
    const name = locale === "en" ? "Transfer" : "划转";
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".reverse-route").click();
    await dialog.getByRole("textbox").fill("20");
    await dialog.locator(".primary").click();
    await expect(dialog.locator(".primary")).toHaveText(
      locale === "en" ? "Waiting for intermediate funds" : "等待中间资金到账",
    );
    await expect(dialog.locator(".primary")).toBeDisabled();
    const count = () =>
      page.evaluate(
        () =>
          (window as any).events.filter(
            (e: any) =>
              e.type === "operationSubmitted" && e.action === "transfer",
          ).length,
      );
    expect(await count()).toBe(1);
    await page.evaluate(() => (window as any).__arriveRepayTopup());
    await expect.poll(count).toBe(2);
    await expect(dialog.getByRole("textbox")).toHaveValue("");
  });
}

test("closing transfer discards intermediate state and starts with fresh balances", async ({
  page,
}) => {
  await mountMockWidget(page, "en");
  await page.evaluate(() => {
    const wallet = (window as any).testWallet;
    const request = wallet.request;
    let sends = 0;
    wallet.request = async (args: any) => {
      if (args.method === "eth_sendTransaction" && ++sends === 2)
        throw { code: 4001 };
      return request(args);
    };
  });
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  await dialog.locator(".primary").click();
  await expect(dialog.locator(".error-toast")).toContainText("declined");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await expect(dialog.locator(".primary")).toBeDisabled();
  await dialog.getByRole("textbox").fill("10");
  await dialog.locator(".primary").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).events.filter(
            (e: any) =>
              e.type === "operationSubmitted" && e.action === "transfer",
          ).length,
      ),
    )
    .toBe(2);
  await expect(dialog.getByRole("textbox")).toHaveValue("");
});

for (const locale of ["en", "zh"]) {
  test(`${locale}: Trade MAX uses contract debt and position limits`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await mountMockWidget(page, locale, { tradeWithdrawable: 12000000n });
    await page
      .getByRole("button", {
        name: locale === "en" ? "Transfer" : "划转",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".reverse-route").click();
    await expect(dialog).toContainText(
      locale === "en" ? "Withdrawable" : "可提现",
    );
    await dialog
      .getByRole("button", {
        name: locale === "en" ? "Max" : "最大",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("textbox")).toHaveValue("11.988");
    await dialog.getByRole("textbox").fill("12.000001");
    await expect(dialog.locator(".primary")).toBeDisabled();
    await dialog.getByRole("textbox").fill("12");
    await expect(dialog.locator(".primary")).toBeEnabled();
  });
}

test("closing after Core arrival drops continuation and reopening withdraws directly", async ({
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
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".reverse-route").click();
  await dialog.getByRole("textbox").fill("20");
  await dialog.locator(".primary").click();
  await expect(dialog.locator(".primary")).toHaveText(
    "Waiting for intermediate funds",
  );
  await page.evaluate(() => (window as any).__arriveRepayTopup());
  await expect(dialog.locator(".primary")).toHaveText("Continue transfer");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /transfer progress/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await dialog.getByRole("textbox").fill("20");
  await dialog.locator(".primary").click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  expect(
    await page.evaluate(
      () =>
        (window as any).events.filter(
          (e: any) =>
            e.type === "operationSubmitted" && e.action === "transfer",
        ).length,
    ),
  ).toBe(2);
});
test("closing during Core arrival cancels automatic continuation", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { repayTopup: true });
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".reverse-route").click();
  await dialog.getByRole("textbox").fill("20");
  await dialog.locator(".primary").click();
  await expect(dialog.locator(".primary")).toHaveText(
    "Waiting for intermediate funds",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__arriveRepayTopup());
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await expect(dialog.getByRole("textbox")).toBeEnabled();
  await expect(dialog.locator(".primary")).not.toHaveText("Continue transfer");
});
