import { expect, test } from "@playwright/test";
import { account, mountMockWidget, owner } from "./rpc-fixture";

test("address copy buttons copy their own address and reflect clipboard success", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.evaluate(() => {
    (window as any).copiedAddresses = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (address: string) => {
          if ((window as any).rejectClipboard)
            throw new Error("Clipboard access denied");
          (window as any).copiedAddresses.push(address);
        },
      },
    });
  });
  const accountCopy = page.locator(".account-address button");
  await accountCopy.click();
  await expect(accountCopy).toHaveAccessibleName("Copied");
  await expect(accountCopy.locator("svg rect")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).copiedAddresses)).toEqual([
    account,
  ]);
  await expect(accountCopy).toHaveAccessibleName("Copy address", {
    timeout: 4000,
  });
  await expect(accountCopy.locator("svg rect")).toHaveCount(1);
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  const ownerCopy = page.locator(".connected-wallet button");
  // Read both rectangles in the same frame while the modal animates.
  const offset = await ownerCopy.evaluate((element) => {
    const button = element.getBoundingClientRect();
    const icon = element.querySelector("svg")!.getBoundingClientRect();
    return {
      x: Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2),
      y: Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2),
    };
  });
  expect(offset.x).toBeLessThan(1);
  expect(offset.y).toBeLessThan(1);
  await ownerCopy.locator("svg").click();
  await expect(ownerCopy).toHaveAccessibleName("Copied");
  await expect(ownerCopy.locator("svg rect")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).copiedAddresses)).toEqual([
    account,
    owner,
  ]);
  await page.evaluate(() => {
    (window as any).rejectClipboard = true;
  });
  await ownerCopy.click();
  await expect(ownerCopy).toHaveAccessibleName("Copy address");
  await expect(ownerCopy.locator("svg rect")).toHaveCount(1);
  const toast = page.locator(".error-toast");
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Clipboard access denied");
  await toast.getByRole("button").click();
  await expect(toast).toHaveCount(0);
  await ownerCopy.click();
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Clipboard access denied");
});
