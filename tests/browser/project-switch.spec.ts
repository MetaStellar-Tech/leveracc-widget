import { test, expect } from "@playwright/test";
import { mountMockWidget, projectId } from "./rpc-fixture";
for (const locale of ["en", "zh"]) {
  test(`${locale}: project metadata and mobile switch dialog`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await mountMockWidget(page, locale, { unbound: true });
    await page.evaluate(({ projectId, locale }) => (window as any).testWidget.update({ config: {
      projectId, locale, network: "testnet", rpcUrl: "https://api.example.test/rpc",
      arbitrumRpcUrl: "https://api.example.test/arbitrum",
      projects: [{ projectId, name: "Custom Partner", description: { en: "Partner description", zh: "项目介绍" } }],
    } }), { projectId, locale });
    await page.getByRole("button", { name: locale === "en" ? "Switch project" : "切换项目", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Custom Partner");
    await expect(dialog).toContainText(locale === "en" ? "Partner description" : "项目介绍");
    await expect(dialog.getByRole("button", { name: locale === "en" ? "Confirm switch" : "确认切换", exact: true })).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: locale === "en" ? "Cancel" : "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
