import { test, expect, type Page } from "@playwright/test";
import { mountMockWidget } from "./rpc-fixture";
const options = {
  mainnet: true,
  noAccount: true,
  lowGas: true,
  noTopUp: true,
  gasFunding: true,
  creationGaslessEthEnabled: true,
  arbitrumEth: "0x0",
};
const open = (page: Page) =>
  page
    .getByRole("button", { name: "Create Trading Account", exact: true })
    .click();
const exchange = (page: Page, amount = "1") =>
  page.getByRole("button", {
    name: `Sign to exchange ${amount} USDC for ETH`,
    exact: true,
  });
const requests = (page: Page) =>
  page.evaluate(() =>
    (window as any).requests.filter(
      (r: any) => r.method === "eth_sendTransaction",
    ),
  );
for (const eth of ["0x0", "0x1"]) {
  test(`gasless ETH ${eth} signs without gas and returns to funding after arrival`, async ({
    page,
  }) => {
    await mountMockWidget(page, "en", { ...options, arbitrumEth: eth });
    await open(page);
    await expect(exchange(page)).toBeEnabled({ timeout: 15000 });
    await exchange(page).click();
    await expect(
      page.getByRole("button", { name: "Waiting for ETH…" }),
    ).toBeDisabled();
    expect(await requests(page)).toHaveLength(0);
    await page.evaluate(() => (window as any).__completeEth());
    await expect(
      page.getByRole("button", { name: /Sign & Swap 3 USDC for Gas/ }),
    ).toBeEnabled({ timeout: 15000 });
    expect(await requests(page)).toHaveLength(0);
    if (eth === "0x0") {
      await page
        .getByRole("button", { name: /Sign & Swap 3 USDC for Gas/ })
        .click();
      await expect.poll(async () => (await requests(page)).length).toBe(1);
      await page.evaluate(() => (window as any).__completeGasFunding());
      await expect(
        page.getByRole("button", {
          name: "Sign & Create Account",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 15000 });
      await page
        .getByRole("button", { name: "Sign & Create Account", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Done", exact: true }),
      ).toBeVisible();
    }
  });
}
test("recovers a submitted exchange on remount without repeating signatures", async ({
  page,
}) => {
  await mountMockWidget(page, "en", options);
  await open(page);
  await exchange(page).click();
  await expect(
    page.getByRole("button", { name: "Waiting for ETH…" }),
  ).toBeDisabled();
  await mountMockWidget(page, "en", options, true);
  await open(page);
  await expect(
    page.getByRole("button", { name: "Waiting for ETH…" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).requests.filter((r: any) => r.method.includes("sign")),
    ),
  ).toHaveLength(0);
  await page.evaluate(() => (window as any).__completeEth());
  await expect(
    page.getByRole("button", { name: /Sign & Swap 3 USDC for Gas/ }),
  ).toBeEnabled({ timeout: 15000 });
});
test("confirmed failure enables explicit retry", async ({ page }) => {
  await mountMockWidget(page, "en", options);
  await open(page);
  await exchange(page).click();
  await expect(
    page.getByRole("button", { name: "Waiting for ETH…" }),
  ).toBeDisabled();
  await page.evaluate(() => (window as any).__completeEth(true));
  await expect(exchange(page)).toBeEnabled({ timeout: 15000 });
  await exchange(page).click();
  await expect(
    page.getByRole("button", { name: "Waiting for ETH…" }),
  ).toBeDisabled();
});
test("configured amount is displayed and manual ETH funding skips exchange", async ({
  page,
}) => {
  await mountMockWidget(page, "en", {
    ...options,
    creationGaslessEthAmountUsdc: "0.5",
  });
  await open(page);
  await expect(exchange(page, "0.5")).toBeEnabled({ timeout: 15000 });
  await expect(page.locator(".gasless-eth-step button")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Refresh balance/i }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/gasless-step.png",
    animations: "disabled",
  });
  await page.evaluate(() => (window as any).__completeEth());
  await expect(
    page.getByRole("button", { name: /Sign & Swap 3 USDC for Gas/ }),
  ).toBeEnabled({ timeout: 15000 });
  expect(await requests(page)).toHaveLength(0);
});
for (const variant of [
  { creationGaslessEthEnabled: false },
  { mainnet: false },
]) {
  test(`does not check gasless when ${JSON.stringify(variant)}`, async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/arbitrum")) calls.push(r.url());
    });
    await mountMockWidget(page, "en", { ...options, ...variant });
    await open(page);
    await expect(
      page.getByRole("button", { name: /Sign & Swap 3 USDC for Gas/ }),
    ).toBeEnabled({ timeout: 15000 });
    await expect(exchange(page)).toHaveCount(0);
    expect(calls).toHaveLength(0);
  });
}

test("destroying the widget during signing prevents submission", async ({
  page,
}) => {
  let submits = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/gas-top-ups/submit")) submits++;
  });
  await mountMockWidget(page, "en", { ...options, hostPrompt: true });
  await open(page);
  await exchange(page).click();
  await expect(
    page.getByRole("dialog", { name: "Host wallet confirmation" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).testWidget.destroy());
  await page.getByRole("button", { name: "Host confirm signature" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("leveracc:widget:gasless:"),
          ).length,
      ),
    )
    .toBe(0);
  await mountMockWidget(page, "en", options, true);
  await open(page);
  await expect(exchange(page)).toBeEnabled({ timeout: 15000 });
  expect(submits).toBe(0);
  expect(await requests(page)).toHaveLength(0);
});

test("ambiguous submission restores status and blocks another exchange", async ({
  page,
}) => {
  await mountMockWidget(page, "en", options);
  let submits = 0;
  await page.route("**/api/v1/gas-top-ups/submit", (route) => {
    submits++;
    return route.abort("failed");
  });
  await open(page);
  await exchange(page).click();
  await expect(
    page.getByRole("button", { name: "Waiting for ETH…" }),
  ).toBeDisabled();
  await mountMockWidget(page, "en", options, true);
  await open(page);
  await expect(
    page.getByRole("button", { name: "Waiting for ETH…" }),
  ).toBeDisabled();
  expect(submits).toBe(1);
});

for (const flow of ["combined", "gas_only", "activation_only"] as const) {
  test(`gasless resumes the ${flow} payment with the correct USDC reserve`, async ({
    page,
  }) => {
    const { gasConfig, receiver } = await import("../gasless-fixtures");
    const { decodeFunctionData } = await import("viem");
    const { IERC20ABI } = await import("../../src/abi/IERC20");
    const estimates: unknown[][] = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/arbitrum")) return;
      const body = request.postDataJSON();
      for (const rpc of Array.isArray(body) ? body : [body]) {
        if (rpc.method !== "eth_estimateGas") continue;
        const decoded = decodeFunctionData({
          abi: IERC20ABI,
          data: rpc.params[0].data,
        });
        if (decoded.functionName === "transfer")
          estimates.push([...decoded.args]);
      }
    });
    await mountMockWidget(page, "en", {
      ...options,
      creationGasConversionEnabled: flow !== "activation_only",
      creationAccountActivationEnabled: flow !== "gas_only",
    });
    await page.route("**/api/v1/*/config*", (route) =>
      route.fulfill({
        json: {
          data: route.request().url().includes("account-activations")
            ? {
                enabled: true,
                status: "ready_to_pay",
                payment_usdc_amount_raw: "1100000",
                activation_receiver_address: receiver,
                arbitrum: gasConfig.arbitrum,
              }
            : { ...gasConfig, account_activation_enabled: true },
        },
      }),
    );
    for (const endpoint of ["gas-conversions", "account-activations"]) {
      await page.route(`**/api/v1/${endpoint}?*`, (route) =>
        route.fulfill({ json: { data: { items: [] } } }),
      );
    }
    await open(page);
    await expect(exchange(page)).toBeEnabled({ timeout: 15000 });
    const reserve = flow === "activation_only" ? "1.1" : "3";
    await expect(
      page.getByText(
        `You need ${flow === "activation_only" ? "2.1" : "4"} USDC in total: 1 USDC for ETH and ${reserve} USDC for the next ${flow === "activation_only" ? "account activation" : "HYPE exchange"}. The remaining ${reserve} USDC is not frozen or charged in advance.`,
      ),
    ).toBeVisible();
    expect(estimates).toContainEqual([
      receiver,
      flow === "activation_only" ? 1100000n : 3000000n,
    ]);
    await exchange(page).click();
    await expect(
      page.getByRole("button", { name: "Waiting for ETH…" }),
    ).toBeDisabled();
    await page.evaluate(() => (window as any).__completeEth());
    await expect(
      page.getByRole("button", {
        name:
          flow === "activation_only"
            ? "Sign & Pay 1.1 USDC for Activation"
            : "Sign & Swap 3 USDC for Gas",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 15000 });
    expect(await requests(page)).toHaveLength(0);
  });
}
