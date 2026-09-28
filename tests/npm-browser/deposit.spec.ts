import { expect, test } from "@playwright/test";
import { mockBackend, owner, projectId } from "../browser/rpc-fixture";

for (const integration of ["react", "embed"]) {
  test(`${integration}: installed deposit keeps one shaded dialog while signing`, async ({
    page,
  }, testInfo) => {
    await mockBackend(page);
    await page.addInitScript(
      ({ owner }) => {
        (window as any).ethereum = {
          on() {},
          removeListener() {},
          request: async ({ method }: { method: string }) => {
            if (method === "eth_accounts" || method === "eth_requestAccounts")
              return [owner];
            if (method === "eth_chainId") return "0x3e6";
            if (method === "eth_signTypedData_v4") {
              await new Promise<void>((resolve) => {
                (window as any).confirmSignature = resolve;
              });
              return `0x${"ab".repeat(64)}1b`;
            }
            throw new Error(method);
          },
        };
      },
      { owner },
    );
    await page.goto("/");
    await page.getByLabel("集成方式").selectOption(integration);
    await page.getByLabel("语言", { exact: true }).selectOption("en");
    await page.getByLabel("项目 ID", { exact: true }).fill(projectId);
    await page.getByRole("button", { name: "应用项目 ID" }).click();
    await page
      .locator(".widget")
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
    const dialog = page.locator("dialog.modal");
    await dialog.evaluate((el) => {
      (window as any).initialDialog = el;
    });
    await dialog.getByLabel("Amount", { exact: true }).fill("10");
    await dialog.locator(".primary").click();
    await expect(dialog.locator(".primary")).toHaveText(
      "Confirm transaction in wallet",
    );
    await expect(dialog.locator(".primary")).toBeDisabled();
    await expect(dialog.locator(".operation")).toHaveCount(0);
    await expect(page.locator(".modal-backdrop")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).confirmSignature))
      .toBe("function");
    await page.screenshot({ path: testInfo.outputPath("deposit-signing.png") });
    await page.evaluate(() => (window as any).confirmSignature());
    await expect(dialog.getByText("Completed", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    expect(
      await dialog.evaluate((el) => el === (window as any).initialDialog),
    ).toBe(true);
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("[data-leveracc-overlay]")).toHaveCount(0);
  });
}
