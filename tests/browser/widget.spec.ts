import { test, expect } from "@playwright/test";
import {
  mountMockWidget,
  mockBackend,
  projectId,
  owner,
  hash,
} from "./rpc-fixture";
const config = {
  network: "testnet",
  projectId,
  rpcUrl: "https://api.example.test/rpc",
};
test("packaged React example has no business actions before wallet connection and isolates styles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/examples-dist/examples/react/");
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Borrow", exact: true }),
  ).toHaveCount(0);
  await page.addStyleTag({
    content: "button {background:red!important;font-size:80px!important}",
  });
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toHaveCSS("background-color", "rgb(0, 153, 255)");
  expect(errors).toEqual([]);
});
test("no account shows only onboarding and a gas-first creation modal", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { noAccount: true, lowGas: true });
  await expect(
    page.getByRole("button", { name: "Create Trading Account", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Trading Account",
    "Deposit",
    "Borrow",
    "Repay",
    "Transfer",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Get HYPE Gas", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign & Create Account", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/widget-onboarding.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("successful creation verifies the account before showing business buttons", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { noAccount: true });
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign & Create Account", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "Your Trade Account has been created. Continue to fund your account.",
      ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".operation")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /View transaction/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Borrow", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Trading Account", exact: true }),
  ).toHaveCount(0);
});
test("read failures never show account creation", async ({ page }) => {
  await mountMockWidget(page, "en", { readError: true });
  await expect(
    page.getByText(
      "Account information is unavailable. Refresh before continuing.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Trading Account", exact: true }),
  ).toHaveCount(0);
});
test("borrow opens a modal, reviews live pricing, and never logs in to v1", async ({
  page,
}) => {
  const errors: string[] = [],
    urls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => urls.push(r.url()));
  await mountMockWidget(page);
  await page.getByRole("button", { name: "Borrow", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount", { exact: true }).fill("25");
  await expect(dialog.getByText("0.0250%")).toBeVisible();
  await dialog.getByRole("button", { name: "Borrow", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Review transaction" }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/widget-borrow.png" });
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
  expect(urls.some((url) => /\/v1|\/auth\/|\/accounts(?:\?|$)/.test(url))).toBe(
    false,
  );
  expect(
    await page.evaluate(() =>
      (window as any).requests.some((r: any) => r.method === "personal_sign"),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
for (const locale of ["en", "zh"]) {
  test(`${locale}: missing authorization blocks borrowing without a setup entry`, async ({
    page,
  }) => {
    await mountMockWidget(page, locale, { unauthorized: true });
    await page.evaluate(() => {
      (window as any).testWidget.update({
        onAccountSetup: async () => {
          throw new Error("Account setup must be handled by the host page");
        },
      });
    });
    await page
      .getByRole("button", {
        name: locale === "en" ? "Borrow" : "借款",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("10");
    await expect(dialog.locator(".primary")).toBeDisabled();
    await expect(dialog.locator(".notice")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", {
        name: locale === "en" ? "Complete account setup" : "完成账户设置",
      }),
    ).toHaveCount(0);
  });
}
test("feature updates close disabled dialogs and allow every feature to be hidden", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page.evaluate(
    (config) =>
      (window as any).testWidget.update({
        config: { ...config, features: { transfer: false } },
      }),
    config,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Transfer", exact: true }),
  ).toHaveCount(0);
  for (const key of [
    "withdraw",
    "tradingAccount",
    "deposit",
    "borrow",
    "repay",
    "transfer",
  ]) {
    await page.evaluate(
      ({ config, key }) =>
        (window as any).testWidget.update({
          config: {
            ...config,
            features: {
              tradingAccount: false,
              deposit: false,
              borrow: false,
              repay: false,
              transfer: false,
              withdraw: false,
              [key]: true,
            },
          },
        }),
      { config, key },
    );
    await expect(page.locator(".entry-actions button")).toHaveCount(
      key === "tradingAccount" ? 0 : 1,
    );
    await expect(
      page.getByRole("button", { name: "Account", exact: true }),
    ).toHaveCount(0);
  }
  await page.evaluate(
    (config) =>
      (window as any).testWidget.update({
        config: {
          ...config,
          features: {
            tradingAccount: false,
            deposit: false,
            borrow: false,
            repay: false,
            transfer: false,
            withdraw: false,
          },
        },
      }),
    config,
  );
  await expect(page.locator(".entry-actions button")).toHaveCount(0);
  await expect(page.getByText("No actions enabled.")).toBeVisible();
  await page.evaluate(async () => {
    await (window as any).testWidget.refresh();
    (window as any).testWidget.destroy();
    (window as any).testWidget.destroy();
  });
  await expect(page.locator("[data-leveracc-widget]")).toHaveCount(0);
});
for (const mobile of [false, true])
  test(`all modal layouts and Fund/Trade direction switching ${mobile ? "mobile Chinese" : "desktop"}`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 360, height: 900 } : { width: 1000, height: 900 },
    );
    await mountMockWidget(page, mobile ? "zh" : "en");
    const names = mobile
      ? ["账户", "充值", "借款", "还款", "划转", "提现"]
      : ["Account", "Deposit", "Borrow", "Repay", "Transfer", "Withdraw"];
    await expect(page.locator(".account-identity")).toBeVisible();
    await page.locator(".widget").screenshot({
      path: `test-results/widget-entries-${mobile}.png`,
    });
    for (let i = 1; i < names.length; i++) {
      await page.getByRole("button", { name: names[i], exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      if (i === 4) {
        await expect(
          page.getByRole("region", {
            name: mobile ? "从" : "From",
            exact: true,
          }),
        ).toContainText(mobile ? "资金账户" : "Fund");
        await page
          .getByRole("button", {
            name: mobile ? "切换方向" : "Reverse direction",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("dialog").locator(".funds-card").first(),
        ).toContainText(mobile ? "交易账户" : "Trade Account");
      }
      await page.screenshot({
        path: `test-results/widget-modal-${i}-${mobile}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: names[i], exact: true }),
      ).toBeFocused();
    }
  });

test("light theme transfer remains readable and MAX stays on one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mountMockWidget(page, "zh");
  await page.evaluate(
    (config) =>
      (window as any).testWidget.update({
        config: { ...config, locale: "zh", theme: "light" },
      }),
    config,
  );
  await page.getByRole("button", { name: "划转", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(
    page.getByRole("button", { name: "最大", exact: true }),
  ).toHaveCSS("white-space", "nowrap");
  await page.screenshot({ path: "test-results/widget-transfer-light.png" });
});

test("host wallet confirmation stays clickable above an active widget transaction", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { hostPrompt: true });
  await page.getByRole("button", { name: "Borrow", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Borrow", exact: true })
    .click();

  await expect(page.locator("dialog.wallet-prompt")).toBeVisible();
  await page
    .getByRole("button", { name: "Host confirm signature", exact: true })
    .click();
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
  await expect(page.locator("dialog.modal")).toHaveAttribute(
    "aria-modal",
    "true",
  );
});
test("wagmi example connects through its connector and clears the widget on disconnect", async ({
  page,
}) => {
  await mockBackend(page);
  // The connector handles discovery/connection; the provider is a test wallet only.
  await page.addInitScript(
    ({ owner, hash }) => {
      const events = new Map<string, Set<(...args: unknown[]) => void>>();
      (window as any).ethereum = {
        isMetaMask: true,
        on: (e: string, f: (...args: unknown[]) => void) => {
          if (!events.has(e)) events.set(e, new Set());
          events.get(e)!.add(f);
        },
        removeListener: (e: string, f: (...args: unknown[]) => void) =>
          events.get(e)?.delete(f),
        request: async ({ method, params }: any) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [owner];
          if (method === "eth_chainId") return "0x3e6";
          if (method === "wallet_requestPermissions")
            return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_revokePermissions") return null;
          if (method === "eth_sendTransaction") return hash;
          if (method === "eth_signTypedData_v4") return `0x${"ab".repeat(65)}`;
          if (method === "wallet_switchEthereumChain") return null;
          throw Error(method);
        },
      };
    },
    { owner, hash },
  );
  await page.goto("/examples-dist/examples/react/");
  await page.getByLabel("LeverAcc project ID").fill(projectId);
  await page
    .getByRole("button", { name: "Apply project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Injected", exact: true }).click();
  await expect(page.getByText(`Connected: ${owner}`)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Borrow", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Borrow", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  await page
    .getByLabel("Widget theme", { exact: true })
    .selectOption("lavender");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue("10");
  await expect(dialog.locator(".primary")).toHaveCSS(
    "background-color",
    "rgb(116, 56, 204)",
  );
  await expect(page.locator(".widget")).toHaveCSS(
    "background-color",
    "rgb(250, 247, 255)",
  );
  await page.getByLabel("Widget theme", { exact: true }).selectOption("dark");
  await expect(dialog.getByRole("textbox")).toHaveValue("10");
  await expect(dialog.locator(".primary")).toHaveCSS(
    "background-color",
    "rgb(0, 153, 255)",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Borrow", exact: true }),
  ).toHaveCount(0);
});
test("Privy example describes required application configuration when no app ID is provided", async ({
  page,
}) => {
  await page.goto("/examples-dist/examples/privy/");
  await expect(
    page.getByRole("heading", { name: "Configure Privy" }),
  ).toBeVisible();
  await expect(page.getByText(/VITE_PRIVY_APP_ID/)).toBeVisible();
});

test("connected owner completes creation, deposit, lending and both account transfer directions", async ({
  page,
}) => {
  test.setTimeout(45000);
  const receiptQueries: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /api.example.test/.test(request.url()) &&
      (request.postData() ?? "").includes("eth_getTransactionReceipt")
    )
      receiptQueries.push(request.url());
    if (request.url().includes("/messages/"))
      receiptQueries.push(request.url());
  });
  await mountMockWidget(page, "en", { noAccount: true });
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign & Create Account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".operation")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /View transaction/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  for (const name of ["Deposit", "Borrow", "Repay"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount", { exact: true }).fill("10");
    await dialog.getByRole("button", { name, exact: true }).click();

    await expect
      .poll(
        () =>
          page.evaluate(
            (action) =>
              (window as any).events.filter(
                (e: any) =>
                  e.type === "operationSubmitted" && e.action === action,
              ).length,
            name.toLowerCase(),
          ),
        { timeout: 20000 },
      )
      .toBe(1);
    await expect(dialog.locator(".operation")).toHaveCount(0);
    await expect(
      dialog.getByRole("link", { name: /View transaction/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Transfer", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Continue transfer", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Continue transfer", exact: true })
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).events.filter(
              (e: any) =>
                e.type === "operationSubmitted" && e.action === "transfer",
            ).length,
        ),
      { timeout: 20000 },
    )
    .toBe(2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByRole("button", { name: "Reverse direction", exact: true })
    .click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Transfer", exact: true })
    .click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).events.filter(
              (e: any) =>
                e.type === "operationSubmitted" && e.action === "transfer",
            ).length,
        ),
      { timeout: 20000 },
    )
    .toBe(3);
  expect(receiptQueries).toEqual(["https://api.example.test/rpc"]);
});

test("static account card and accessible collateral breakdown", async ({
  page,
}) => {
  await mountMockWidget(page);
  await expect(page.locator(".entry-actions button")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh status", exact: true }),
  ).toHaveCount(0);
  await page.locator(".account-identity").hover();
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await page.locator(".account-identity").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const info = page.getByRole("button", { name: "Collateral breakdown" });
  await info.hover();
  await expect(page.getByRole("tooltip")).toContainText("HyperEVM");
  await expect(page.getByRole("tooltip")).toContainText("HyperCore");
  await page.screenshot({ path: "test-results/collateral-hover.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await info.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
});

test("legacy failed, pending and malformed transactions never restore or block interaction", async ({
  page,
}) => {
  await mountMockWidget(page);
  await page.evaluate(() => {
    localStorage.setItem(
      "leveracc:widget:v1:old",
      JSON.stringify({ stage: "submitting" }),
    );
    localStorage.setItem("leveracc:widget:gas:old", "{corrupt");
    localStorage.setItem("host-preference", "keep");
  });
  await mountMockWidget(page, "en", {}, true);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("leveracc:widget:"),
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.getItem("host-preference")),
  ).toBe("keep");
  await page.getByRole("button", { name: "Borrow", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  await dialog.locator(".primary").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).events.some(
          (e: any) => e.type === "operationSubmitted" && e.action === "borrow",
        ),
      ),
    )
    .toBe(true);
  await expect(dialog.locator(".operation")).toHaveCount(0);
});

test("background refresh retains account content and settles on success and read failure", async ({
  page,
}) => {
  await mountMockWidget(page);
  await expect(page.locator(".account-copy")).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const holdRpc = async (route: import("@playwright/test").Route) => {
    entered();
    await gate;
    await route.fallback();
  };
  await page.route("https://api.example.test/rpc", holdRpc);
  await page.evaluate(() => {
    (window as any).refreshComplete = (window as any).testWidget.refresh();
  });
  await started;
  await expect(page.locator(".account-board .skeleton")).toHaveCount(0);
  await expect(page.locator(".account-copy")).toBeVisible();
  await page.screenshot({ path: "test-results/account-refreshing.png" });
  await page.locator("main").evaluate((el) => {
    el.style.maxWidth = "none";
  });
  for (const width of [280, 375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page
        .locator(".account-board")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page
      .locator(".widget")
      .screenshot({ path: `test-results/responsive-refreshing-${width}.png` });
  }
  release();
  await page.evaluate(() => (window as any).refreshComplete);
  await page.unroute("https://api.example.test/rpc", holdRpc);
  await expect(page.locator(".account-identity")).toBeVisible();
  await expect(page.locator(".account-board .skeleton")).toHaveCount(0);
  const readyHeight = await page
    .locator(".widget")
    .evaluate((el) => el.getBoundingClientRect().height);
  await page.route("https://api.example.test/rpc", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: route.request().postDataJSON().id,
        error: { code: -32000, message: "RPC unavailable" },
      }),
    }),
  );
  await page.evaluate(() => {
    void (window as any).testWidget.refresh();
  });
  await expect(page.locator(".body").getByRole("alert").first()).toBeVisible();
  await expect(page.locator(".error-toast")).toHaveCSS("position", "fixed");
  await expect(page.locator(".account-identity")).toBeVisible();
  for (const button of await page.locator(".entry-actions button").all()) {
    await expect(button).toBeEnabled();
  }
  const failedHeight = await page
    .locator(".widget")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(failedHeight).toBe(readyHeight);
  await expect(page.locator(".error-toast")).toHaveCount(0, { timeout: 7000 });
  expect(
    await page
      .locator(".widget")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(readyHeight);

  await expect(page.locator(".account-board .skeleton")).toHaveCount(0);
});

for (const theme of ["dark", "light"] as const) {
  test(`narrow ${theme} collateral card supports touch without overflow`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 700 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await mountMockWidget(page, "zh");
    await page.evaluate(
      ({ config, theme }) =>
        (window as any).testWidget.update({
          config: { ...config, locale: "zh", theme },
        }),
      { config, theme },
    );
    const info = page.getByRole("button", { name: "抵押品金额分布" });
    await info.tap();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const box = await tooltip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(
      await page
        .locator(".widget")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/account-${theme}-touch.png` });
    await info.tap();
    await expect(tooltip).not.toBeVisible();
    await context.close();
  });
}

test("paid creation survives reload and reopening without another top-up", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { noAccount: true });
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Create Trading Account", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sign & Create Account", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
  }
  await mountMockWidget(page, "en", { noAccount: true }, true);
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign & Create Account", exact: true }),
  ).toBeEnabled();
});

test("gas alone cannot unlock account creation", async ({ page }) => {
  await mountMockWidget(page, "en", { noAccount: true, noTopUp: true });
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Sign & Swap 3 USDC for Gas",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Sign & Create Account", exact: true }),
  ).toHaveCount(0);
});

for (const mainnet of [true, false]) {
  test(`built-in ${mainnet ? "Arbitrum" : "HyperCore"} 3 USDC funding resumes automatically and creation waits for confirmation`, async ({
    page,
  }) => {
    const options = {
      mainnet,
      noAccount: true,
      lowGas: true,
      gasFunding: true,
    };
    await mountMockWidget(page, "en", options);
    await page
      .getByRole("button", { name: "Create Trading Account", exact: true })
      .click();
    const coreSubmitted = mainnet
      ? undefined
      : page.waitForResponse(
          (response) =>
            response.url() === "https://api.hyperliquid-testnet.xyz/exchange" &&
            response.request().method() === "POST",
        );
    await page
      .getByRole("button", { name: "Sign & Swap 3 USDC for Gas", exact: true })
      .click();
    if (coreSubmitted) await coreSubmitted;
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).events.some(
            (e: any) =>
              e.type === "operationSubmitted" && e.action === "gasFunding",
          ),
        ),
      )
      .toBe(true);
    await expect(page.locator(".operation")).toHaveCount(0);
    const requests = await page.evaluate(() => (window as any).requests);
    if (mainnet) {
      const transfers = requests.filter(
        (r: any) => r.method === "eth_sendTransaction",
      );
      expect(transfers).toHaveLength(1);
      expect(transfers[0].params[0].to.toLowerCase()).toBe(
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      );
    } else {
      expect(
        requests.some((r: any) => r.method === "eth_signTypedData_v4"),
      ).toBe(true);
      expect(
        requests.some((r: any) => r.method === "eth_sendTransaction"),
      ).toBe(false);
    }
    await mountMockWidget(page, "en", options, true);
    await page
      .getByRole("button", { name: "Create Trading Account", exact: true })
      .click();
    await expect(
      page.getByText("Waiting for HYPE to arrive. Do not send again."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Sign & Swap 3 USDC for Gas",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Refresh status", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).requests.filter(
          (r: any) => r.method === "eth_sendTransaction",
        ),
      ),
    ).toHaveLength(0);
    await page.evaluate(() => (window as any).__completeGasFunding());
    await expect(
      page.getByRole("button", { name: "Sign & Create Account", exact: true }),
    ).toBeEnabled({ timeout: 25000 });
    await page
      .getByRole("button", { name: "Sign & Create Account", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toBeVisible();
  });
}

for (const mainnet of [true, false]) {
  test(`creation history opt-out works with unavailable history on ${mainnet ? "mainnet" : "testnet"}`, async ({
    page,
  }) => {
    const historyRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/gas-top-ups?"))
        historyRequests.push(request.url());
    });
    await mountMockWidget(page, "en", {
      mainnet,
      noAccount: true,
      noTopUp: true,
      topUpError: true,
      skipCreationTopUpCheck: true,
    });
    await page
      .getByRole("button", { name: "Create Trading Account", exact: true })
      .click();
    const create = page.getByRole("button", {
      name: "Sign & Create Account",
      exact: true,
    });
    await expect(create).toBeEnabled();
    await expect(
      page.getByRole("button", {
        name: "Sign & Swap 3 USDC for Gas",
        exact: true,
      }),
    ).toHaveCount(0);
    await create.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).events.some(
            (e: any) =>
              e.type === "operationSubmitted" && e.action === "createAccount",
          ),
        ),
      )
      .toBe(true);
    expect(historyRequests).toEqual([]);
  });
}

test("creation waits for its receipt across reload without sending again", async ({
  page,
}) => {
  const options = { noAccount: true, delayedCreationReceipt: true };
  await mountMockWidget(page, "en", options);
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign & Create Account", exact: true })
    .click();
  await expect(
    page.getByText(
      "Creating your trading account. Waiting for on-chain confirmation…",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCount(0);
  await mountMockWidget(page, "en", options, true);
  await page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
  await expect(
    page.getByText(
      "Creating your trading account. Waiting for on-chain confirmation…",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign & Create Account", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).__completeCreation());
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(
    await page.evaluate(() =>
      (window as any).requests.filter(
        (r: any) => r.method === "eth_sendTransaction",
      ),
    ),
  ).toHaveLength(0);
});
