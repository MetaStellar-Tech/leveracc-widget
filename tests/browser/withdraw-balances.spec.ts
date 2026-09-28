import { test, expect } from "@playwright/test";
import { encodeAbiParameters, toFunctionSelector } from "viem";
import { mountMockWidget, owner, projectId } from "./rpc-fixture";

test("withdraw reads both networks on open and reopen, shows zero, and recovers from RPC failure", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  let fund = 123456789n,
    arbitrum = 9876543n,
    maximum = 31000000n,
    failArbitrum = false;
  const claimable = toFunctionSelector(
    "previewSafeUserClaimablePrimaryDirect(uint32)",
  );
  await page.route("https://api.example.test/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON();
    const data = body.params?.[0]?.data as string | undefined;
    const destination = request.url().endsWith("/arbitrum");
    if (
      body.method === "eth_call" &&
      data &&
      ((data.startsWith("0x70a08231") &&
        data.toLowerCase().endsWith(owner.slice(2))) ||
        data.startsWith(claimable))
    ) {
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          ...(destination && failArbitrum
            ? {
                error: {
                  code: -32000,
                  message: "Arbitrum balance unavailable",
                },
              }
            : {
                result: encodeAbiParameters(
                  [{ type: "uint256" }],
                  [
                    data.startsWith(claimable)
                      ? maximum
                      : destination
                        ? arbitrum
                        : fund,
                  ],
                ),
              }),
        },
      });
    } else await route.fallback();
  });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Refresh balances", exact: true }),
  ).toHaveCount(0);
  const source = dialog.locator(".funds-card").nth(0).locator(".funds-meta");
  const destination = dialog
    .locator(".funds-card")
    .nth(1)
    .locator(".funds-meta");
  await expect(source).toContainText("31 USDC");
  await expect(source).toContainText("Withdrawable");
  await expect(destination).toContainText("9.876543 USDC");
  await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await expect(source).toContainText("123.456789 USDC");
  await dialog.getByRole("button", { name: "Max", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("123.456789");

  fund = 0n;
  arbitrum = 42500000n;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await expect(source).toContainText("0 USDC");
  await expect(destination).toContainText("42.5 USDC");
  await expect(dialog.locator(".primary")).toBeDisabled();

  failArbitrum = true;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await expect(destination).toContainText("-- USDC");
  await expect(dialog.getByRole("alert")).toContainText(
    "Arbitrum balance unavailable",
  );
  failArbitrum = false;
  fund = 88250000n;
  arbitrum = 111000000n;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await expect(source).toContainText("88.25 USDC");
  await expect(destination).toContainText("111 USDC");
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  await page.keyboard.press("Escape");
  maximum = 5250000n;
  arbitrum = 2000000n;
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(source).toContainText("5.25 USDC");
  await expect(destination).toContainText("2 USDC");
});

test("Trade Max uses live spot holds and interest and fails closed on Core errors", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  let fail = false;
  let total = "25.12345601";
  const users: string[] = [];
  await page.route("https://api.hyperliquid.xyz/info", async (route) => {
    const body = route.request().postDataJSON();
    if (body.type !== "spotClearinghouseState") return route.fallback();
    users.push(body.user);
    if (fail)
      return route.fulfill({ status: 400, body: "Core balance unavailable" });
    return route.fulfill({
      json: { balances: [{ coin: "USDC", total, hold: "1.00000099" }] },
    });
  });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Refresh balances", exact: true }),
  ).toHaveCount(0);
  const source = dialog.locator(".funds-card").nth(0).locator(".funds-meta");
  // 750 EVM + (25.123456 - 1 - 0.005) Core - 0.25 interest.
  await expect(source).toContainText("773.868456 USDC");
  expect(users).toContain("0x2222222222222222222222222222222222222222");
  await dialog.getByRole("button", { name: "Max", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("773.868456");
  fail = true;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(source).toContainText("-- USDC");
  await expect(dialog.locator(".primary")).toBeDisabled();
  fail = false;
  total = "10";
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(source).toContainText("758.745 USDC");
  await expect(dialog.locator(".primary")).toBeDisabled();
  await dialog.getByRole("button", { name: "Max", exact: true }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("758.745");
});

for (const fund of [false, true]) {
  test(`testnet ${fund ? "Fund" : "Trade"} withdrawal uses testnet balances, fees and transactions`, async ({
    page,
  }) => {
    await mountMockWidget(page, "en");
    const requests: { url: string; body: any }[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" || request.url().includes("iris-api")) {
        requests.push({
          url: request.url(),
          body:
            request.method() === "POST" ? request.postDataJSON() : undefined,
        });
      }
    });
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (fund) {
      await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
      await page
        .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
        .click();
    }
    const source = dialog.locator(".funds-card").nth(0).locator(".funds-meta");
    await expect(source).toContainText(fund ? "1250 USDC" : "1175.245 USDC");
    await expect(dialog.locator(".funds-card").nth(1)).toContainText(
      "Arbitrum Sepolia",
    );
    await expect(
      dialog.locator(".funds-card").nth(1).locator(".funds-meta"),
    ).toContainText("1250 USDC");
    await dialog.getByRole("textbox").fill("10");
    await expect(dialog.locator(".primary")).toBeEnabled();
    await dialog.locator(".primary").click();
    if (fund) {
      await expect(dialog.locator(".primary")).toHaveText("Withdraw USDC");
      await expect(dialog.locator(".primary")).toBeEnabled();
      await dialog.locator(".primary").click();
    }
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as any).requests.filter(
              (r: any) => r.method === "eth_sendTransaction",
            ).length,
        ),
      )
      .toBe(fund ? 2 : 1);
    const walletRequests = await page.evaluate(() => (window as any).requests);
    if (fund) {
      const sent = walletRequests.filter(
        (r: any) => r.method === "eth_sendTransaction",
      );
      expect(sent[0].params[0].to.toLowerCase()).toBe(
        "0x2b3370ee501b4a559b57d449569354196457d8ab",
      );
      expect(sent[1].params[0].to.toLowerCase()).toBe(
        "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
      );
    } else {
      const typed = JSON.parse(
        walletRequests.find((r: any) => r.method === "eth_signTypedData_v4")
          .params[1],
      );
      expect(Number(typed.domain.chainId)).toBe(998);
      expect(Number(typed.message.destinationChainId)).toBe(421614);
    }
    expect(
      requests.some((r) =>
        r.url.startsWith(
          "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/19/3",
        ),
      ),
    ).toBe(true);
    expect(
      requests.some((r) => r.url.startsWith("https://iris-api.circle.com/")),
    ).toBe(false);
    const reads = requests.filter((r) => r.body?.method === "eth_call");
    expect(
      reads.some(
        (r) =>
          r.url.endsWith("/arbitrum") &&
          r.body.params[0].to.toLowerCase() ===
            "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
      ),
    ).toBe(true);
    expect(
      reads.some((r) =>
        [
          "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          "0xb88339cb7199b77e23db6e890353e22632ba630f",
        ].includes(r.body.params[0].to.toLowerCase()),
      ),
    ).toBe(false);
  });
}

test("withdraw typing retains focus and reuses fee parameters across amounts and sources", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  let fees = 0;
  page.on("request", (request) => {
    if (request.url().includes("/burn/USDC/fees/")) fees++;
  });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox");
  await expect.poll(() => fees).toBe(1);
  await input.focus();
  await input.pressSequentially("12.34", { delay: 400 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("12.34");
  await input.press("ArrowLeft");
  await input.press("Backspace");
  await expect(input).toHaveValue("12.4");
  await expect(input).toBeFocused();
  await expect(dialog.locator(".primary")).toBeEnabled();
  expect(fees).toBe(1);
  await dialog.getByRole("combobox", { name: "Withdrawal source" }).click();
  await page
    .getByRole("option", { name: "Fund Account (HyperEVM)", exact: true })
    .click();
  await input.fill("10");
  await expect(dialog.locator(".primary")).toBeEnabled();
  expect(fees).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await input.fill("10");
  await expect(dialog.locator(".primary")).toBeEnabled();
  expect(fees).toBe(1);
  await dialog.locator(".primary").click();
  await expect.poll(() => fees).toBe(2);
  await expect(input).toHaveValue("");
  await expect(dialog.locator(".primary")).toBeDisabled();
  await expect(dialog.locator(".operation")).toHaveCount(0);
  await expect(dialog).not.toContainText("Transaction submitted");
});

test("explicitly disabled Trade withdrawal explains why submission is unavailable", async ({
  page,
}) => {
  await mountMockWidget(page, "en", { mainnet: true });
  await page.evaluate(
    (projectId) =>
      (window as any).testWidget.update({
        config: {
          projectId,
          network: "mainnet",
          rpcUrl: "https://api.example.test/rpc",
          arbitrumRpcUrl: "https://api.example.test/arbitrum",
          arbitrumWithdrawalEnabled: false,
        },
      }),
    projectId,
  );
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  await expect(dialog.getByRole("note")).toContainText(
    "unavailable for this deployment",
  );
  await expect(dialog.locator(".primary")).toBeDisabled();
});

test("increased withdrawal fees require another confirmation without moving the form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mountMockWidget(page, "en", { mainnet: true });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("10");
  const primary = dialog.locator(".primary");
  await expect(primary).toBeEnabled();
  const before = await primary.boundingBox();
  await page.evaluate(() => {
    (window as any).__bridgeFee = "200000";
  });
  await primary.click();
  await expect(dialog.getByRole("alert").first()).toContainText(
    "fee increased",
  );
  await expect(primary).toBeEnabled();
  expect((await primary.boundingBox())?.y).toBe(before?.y);
  expect(
    await page.evaluate(
      () =>
        (window as any).requests.filter(
          (r: any) => r.method === "eth_sendTransaction",
        ).length,
    ),
  ).toBe(0);
  await expect(dialog.locator(".funds-estimates")).toContainText("0.2");
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
    .toBe(1);
  await expect(dialog.locator(".operation")).toHaveCount(0);
});
