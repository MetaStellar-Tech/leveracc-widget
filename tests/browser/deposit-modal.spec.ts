import { expect, test } from "@playwright/test";
import { mountMockWidget } from "./rpc-fixture";

for (const mainnet of [false, true]) {
  test(`deposit retains its dialog and backdrop through ${mainnet ? "Arbitrum approval and bridge" : "Core signature and settlement"}`, async ({
    page,
  }) => {
    await mountMockWidget(page, "en", { mainnet });
    await page.evaluate(() => {
      const wallet = (window as any).testWallet;
      const original = wallet.request;
      wallet.request = async (request: any) => {
        if (
          ["eth_signTypedData_v4", "eth_sendTransaction"].includes(
            request.method,
          )
        ) {
          await new Promise<void>((resolve) => {
            (window as any).releaseSignature = resolve;
          });
        }
        return original(request);
      };
      // A clipped, transformed embed must not constrain the page-level overlay.
      document.querySelector<HTMLElement>("#test-widget")!.style.cssText =
        "transform:translateZ(0);overflow:hidden;max-height:400px";
    });
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
    const dialog = page.locator("dialog.modal");
    await dialog.evaluate((el) => {
      (window as any).depositDialog = el;
    });
    await dialog.getByLabel("Amount", { exact: true }).fill("10");
    const primary = dialog.locator(".primary");
    const backdrop = page.locator(".modal-backdrop");
    for (let step = 0; step < (mainnet ? 2 : 1); step++) {
      await expect(primary).toBeEnabled();
      await primary.click();
      await expect
        .poll(() =>
          page.evaluate(() => typeof (window as any).releaseSignature),
        )
        .toBe("function");
      await expect(primary).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeDisabled();
      await expect(primary).toHaveText(
        /Waiting for signature|Confirm transaction in wallet/,
      );
      await expect(dialog.locator(".operation")).toHaveCount(0);
      await expect(backdrop).toBeVisible();
      await expect(backdrop).toHaveCSS("background-color", /\/ 0\.5\)/);
      const box = await backdrop.boundingBox();
      expect(box).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
      await page.keyboard.press("Escape");
      await backdrop.click({ position: { x: 2, y: 2 } });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
        "10",
      );
      expect(
        await dialog.evaluate((el) => el === (window as any).depositDialog),
      ).toBe(true);
      await page.evaluate(() => {
        (window as any).releaseSignature();
        delete (window as any).releaseSignature;
      });
      if (mainnet && step === 0)
        await expect(primary).toHaveText("Deposit USDC");
    }
    await expect(dialog.locator(".operation")).toHaveCount(0);
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("");
    await expect(primary).toBeDisabled();
    if (mainnet)
      await expect(
        dialog.getByRole("link", { name: /View transaction/ }),
      ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("leveracc:widget:"),
        ),
      ),
    ).toEqual([]);
    expect(
      await dialog.evaluate((el) => el === (window as any).depositDialog),
    ).toBe(true);
    await expect(dialog).toHaveCount(1);
    await expect(backdrop).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("[data-leveracc-overlay]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Deposit", exact: true }),
    ).toBeFocused();
  });
}

test("deposit signature rejection can retry in the same dialog and host wallet receives focus", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { hostPrompt: true });
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  const dialog = page.locator("dialog.modal");
  await dialog.evaluate((el) => {
    (window as any).depositDialog = el;
  });
  await dialog.getByLabel("Amount", { exact: true }).fill("10");
  await page.evaluate(() => {
    (window as any).__rejectSignatureOnce = true;
  });
  await dialog.locator(".primary").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events.some((event: any) => event.type === "error"),
      ),
    )
    .toBe(true);
  await expect(dialog.locator(".error-toast")).toContainText("declined");
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("10");
  await dialog.locator(".primary").click();
  const confirm = page.getByRole("button", {
    name: "Host confirm signature",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await expect(page.locator(".modal-backdrop")).toBeVisible();
  await confirm.click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).events.some(
            (event: any) => event.type === "operationSubmitted",
          ),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  await expect(page.locator(".operation")).toHaveCount(0);
  expect(
    await dialog.evaluate((el) => el === (window as any).depositDialog),
  ).toBe(true);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) =>
      el.contains((el.getRootNode() as ShadowRoot).activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-leveracc-overlay]")).toHaveCount(0);
});

for (const width of [375, 1280]) {
  test(`deposit failure feedback does not move the form at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mountMockWidget(page);
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
    const dialog = page.locator("dialog.modal");
    await dialog.getByLabel("Amount", { exact: true }).fill("10");
    const primary = dialog.locator(".primary");
    await expect(primary).toBeEnabled();
    await primary.scrollIntoViewIfNeeded();
    const geometry = () =>
      dialog.evaluate((el) => ({
        dialog: el.getBoundingClientRect().toJSON(),
        button: el.querySelector(".primary")!.getBoundingClientRect().toJSON(),
        height: el.scrollHeight,
      }));
    const before = await geometry();
    await page.evaluate(() => {
      (window as any).__rejectSignatureOnce = true;
    });
    await primary.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).events.some((event: any) => event.type === "error"),
        ),
      )
      .toBe(true);
    await expect(dialog.locator(".error-toast")).toContainText("declined");
    await expect(primary).toBeEnabled();
    expect(await geometry()).toEqual(before);
    await expect(dialog.locator(".operation")).toHaveCount(0);
    await expect(dialog.locator(".error-toast")).toHaveCount(1);
    await expect(dialog.locator(".error-toast")).toHaveCSS("position", "fixed");
    await dialog.locator(".error-toast button").click();
    await expect(dialog.locator(".error-toast")).toHaveCount(0);
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
      "10",
    );
    await page.evaluate(() => {
      (window as any).__rejectSignatureOnce = true;
    });
    await primary.click();
    await expect(primary).toBeEnabled();
    await expect(dialog.locator(".error-toast")).toContainText("declined");
    await expect(dialog.locator(".error-toast")).toHaveCount(1);
    expect(await geometry()).toEqual(before);
    await expect(dialog.locator(".error-toast")).toHaveCount(0, {
      timeout: 7000,
    });
  });
}

test("wallet rejection is cleared on remount without persistent state", async ({
  page,
}) => {
  await mountMockWidget(page);
  const openDeposit = async () => {
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
    return page.locator("dialog.modal");
  };
  let dialog = await openDeposit();
  await dialog.getByLabel("Amount", { exact: true }).fill("10");
  await page.evaluate(() => {
    (window as any).__rejectSignatureOnce = true;
  });
  await dialog.locator(".primary").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events.some((event: any) => event.type === "error"),
      ),
    )
    .toBe(true);
  await expect(dialog.locator(".error-toast")).toContainText("declined");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Failed", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Request declined in wallet. You can try again.", {
      exact: true,
    }),
  ).toHaveCount(0);
  dialog = await openDeposit();
  await expect(dialog.locator(".error-toast")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  // Preserve storage while constructing a new widget, as on page reload.
  await mountMockWidget(page, "en", {}, true);
  await expect(
    page.getByRole("button", { name: "Deposit", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toHaveCount(0);
  dialog = await openDeposit();
  await expect(dialog.locator(".error-toast")).toHaveCount(0);
  await dialog.getByLabel("Amount", { exact: true }).fill("10");
  await page.evaluate(() => {
    (window as any).__rejectSignatureOnce = true;
  });
  await dialog.locator(".primary").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events.some((event: any) => event.type === "error"),
      ),
    )
    .toBe(true);
  await expect(dialog.locator(".error-toast")).toContainText("declined");
});

test("testnet external deposit approves and bridges on Arbitrum Sepolia", async ({
  page,
}) => {
  await mountMockWidget(page, "en");
  const feeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/burn/USDC/fees/"))
      feeRequests.push(request.url());
  });
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /External Deposit/ }).click();
  await expect(dialog.locator(".funds-card").first()).toContainText(
    "Arbitrum Sepolia",
  );
  await expect(dialog.locator(".funds-card").nth(1)).toContainText(
    "HyperEVM Testnet",
  );
  const input = dialog.getByRole("textbox");
  await input.fill("10");
  const primary = dialog.locator(".primary");
  await expect(primary).toBeEnabled();
  await expect(primary).toContainText("Approve");
  await primary.click();
  await expect(primary).toHaveText("Deposit USDC");
  await expect(primary).toBeEnabled();
  await primary.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).requests.filter(
            (r: any) => r.method === "eth_sendTransaction",
          ).length,
      ),
    )
    .toBe(2);
  const requests = await page.evaluate(() => (window as any).requests);
  const sent = requests.filter((r: any) => r.method === "eth_sendTransaction");
  expect(sent[0].params[0].to.toLowerCase()).toBe(
    "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
  );
  expect(sent[1].params[0].to.toLowerCase()).toBe(
    "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
  );
  const switches = requests.filter(
    (r: any) => r.method === "wallet_switchEthereumChain",
  );
  expect(switches.at(-1).params[0].chainId).toBe("0x66eee");
  expect(
    await page.evaluate(() =>
      (window as any).events
        .filter((event: any) => event.type === "operationSubmitted")
        .every((event: any) => event.chainId === 421614),
    ),
  ).toBe(true);
  expect(feeRequests.length).toBeGreaterThan(0);
  expect(
    feeRequests.every((url) =>
      url.startsWith(
        "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/3/19",
      ),
    ),
  ).toBe(true);
  await expect(
    dialog.getByRole("link", { name: /View transaction/ }),
  ).toHaveCount(0);
});
