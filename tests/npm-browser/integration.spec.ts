import { test, expect } from "@playwright/test";
for (const integration of ["react", "embed"]) {
  test(`${integration}: installed npm package previews themes and locale`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByLabel("集成方式").selectOption(integration);
    const widget = page.locator(".widget");
    await expect(widget).toBeVisible();
    for (const [theme, scheme, color] of [
      ["light", "light", "rgb(255, 255, 255)"],
      ["midnight", "dark", "rgb(15, 23, 42)"],
      ["lavender", "light", "rgb(250, 247, 255)"],
      ["dark", "dark", "rgb(23, 26, 32)"],
    ]) {
      await page.getByLabel("主题配色").selectOption(theme);
      await expect(widget).toHaveCSS("background-color", color);
      await expect(widget).toHaveCSS("color-scheme", scheme);
    }
    await page.getByLabel("语言", { exact: true }).selectOption("en");
    await expect(
      widget.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeVisible();
    await page.getByLabel("项目 ID", { exact: true }).fill("invalid");
    await page.getByRole("button", { name: "应用项目 ID" }).click();
    await expect(page.getByRole("alert")).toContainText("32 字节");
    await expect(widget).toBeVisible();
    expect(errors).toEqual([]);
  });
}
