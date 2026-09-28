import { expect, test, type Page } from "@playwright/test";
import { mountMockWidget } from "./rpc-fixture";

async function rejectNextWalletRequest(page: Page) {
  await page.evaluate(() => {
    const wallet = (window as any).testWallet;
    const original = wallet.request;
    wallet.request = async (request: any) => {
      if (
        ["eth_signTypedData_v4", "eth_sendTransaction"].includes(request.method)
      ) {
        wallet.request = original;
        throw { code: 4001 };
      }
      return original(request);
    };
  });
}

for (const action of ["Borrow", "Repay", "Transfer", "Create", "Bind"]) {
  test(`${action} failure uses one floating alert and permits retry`, async ({
    page,
  }) => {
    await mountMockWidget(page, "en", {
      noAccount: action === "Create",
      unbound: action === "Bind",
    });
    const entry =
      action === "Create"
        ? "Create Trading Account"
        : action === "Bind"
          ? "Switch project"
          : action;
    await page.getByRole("button", { name: entry, exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (!["Create", "Bind"].includes(action))
      await dialog.getByLabel("Amount", { exact: true }).fill("10");
    const submit = dialog.getByRole("button", {
      name:
        action === "Create"
          ? "Sign & Create Account"
          : action === "Bind"
            ? "Confirm in wallet"
            : action,
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await rejectNextWalletRequest(page);
    await submit.click();
    const toast = dialog.locator(".error-toast");
    await expect(toast).toContainText("declined");
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveCSS("position", "fixed");
    await expect(dialog.locator(".operation")).toHaveCount(0);
    const retry =
      action === "Transfer"
        ? dialog.getByRole("button", { name: "Continue transfer", exact: true })
        : submit;
    await expect(retry).toBeEnabled();
    await toast.getByRole("button").click();
    await expect(toast).toHaveCount(0);
    await retry.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).events.some(
            (e: any) => e.type === "operationSubmitted",
          ),
        ),
      )
      .toBe(true);
    await expect(dialog.locator(".operation")).toHaveCount(0);
    await expect(
      dialog.getByRole("link", { name: /View transaction/ }),
    ).toHaveCount(0);
    await expect(toast).toHaveCount(0);
    if (action === "Borrow" || action === "Repay") {
      await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
        "",
      );
      await expect(dialog.locator(".primary")).toBeDisabled();
      if (action === "Borrow")
        await expect(dialog.getByRole("slider")).toHaveValue("0");
    }
  });
}

test("multi-step withdrawal failure retains continuation and can retry", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount", { exact: true }).fill("800");
  await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
  const next = dialog.getByRole("button", {
    name: "Continue withdrawal",
    exact: true,
  });
  await expect(next).toBeEnabled();
  await rejectNextWalletRequest(page);
  await next.click();
  await expect(dialog.locator(".error-toast")).toContainText("declined");
  await expect(dialog.locator(".error-toast")).toHaveCount(1);
  await expect(dialog.locator(".operation")).toHaveCount(0);
  await expect(next).toBeEnabled();
  await expect(dialog.locator(".withdraw-requote")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Review updated proceeds" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).events.filter(
            (e: any) =>
              e.type === "operationSubmitted" && e.action === "withdraw",
          ).length,
      ),
    )
    .toBe(2);
  await expect(dialog.locator(".error-toast")).toHaveCount(0);
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("");
  await expect(dialog.locator(".primary")).toBeDisabled();
  await expect(dialog.locator(".operation")).toHaveCount(0);
});

test("withdrawal continuation reviews higher fees in the original fields", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount", { exact: true }).fill("800");
  await dialog.locator(".primary").click();
  const next = dialog.getByRole("button", {
    name: "Continue withdrawal",
    exact: true,
  });
  await expect(next).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__bridgeFee = "200000";
  });
  await next.click();
  await expect(dialog.locator(".error-toast")).toContainText(
    "Bridge fee increased",
  );
  await expect(
    dialog.locator(".withdraw-requote, .notice, .operation"),
  ).toHaveCount(0);
  await expect(dialog.locator(".funds-estimates")).toContainText("0.2 USDC");
  await expect(next).toBeEnabled();
  await next.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).events.filter(
            (e: any) =>
              e.type === "operationSubmitted" && e.action === "withdraw",
          ).length,
      ),
    )
    .toBe(2);
  await expect(dialog.locator(".error-toast")).toHaveCount(0);
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("");
  await expect(dialog.locator(".primary")).toBeDisabled();
});

for (const action of ["Transfer", "Deposit", "Withdraw"]) {
  test(`${action} can cancel after approval and reopen to continue`, async ({
    page,
  }) => {
    await mountMockWidget(page, "en", { mainnet: true });
    await page.getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (action === "Withdraw") {
      await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
      await dialog
        .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
        .click();
    }
    await dialog.getByLabel("Amount", { exact: true }).fill("10");
    await dialog.locator(".primary").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).events.filter(
              (e: any) => e.type === "operationSubmitted",
            ).length,
        ),
      )
      .toBe(1);
    await expect(dialog.locator(".primary")).toBeEnabled();
    await rejectNextWalletRequest(page);
    await dialog.locator(".primary").click();
    await expect(dialog.locator(".error-toast")).toContainText("declined");
    await expect(dialog.locator(".withdraw-requote, .operation")).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: action, exact: true }).click();
    if (action === "Withdraw") {
      await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
      await dialog
        .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
        .click();
    }
    if (action !== "Transfer")
      await dialog.getByLabel("Amount", { exact: true }).fill("10");
    await dialog.locator(".primary").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).events.filter(
              (e: any) => e.type === "operationSubmitted",
            ).length,
        ),
      )
      .toBe(2);
    await expect(dialog.locator(".error-toast")).toHaveCount(0);
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("");
    await expect(dialog.locator(".primary")).toBeDisabled();
  });
}
