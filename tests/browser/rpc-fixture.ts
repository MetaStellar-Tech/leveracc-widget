import type { Page } from "@playwright/test";
import {
  decodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  encodeFunctionResult,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { ILeverAccAccountABI } from "../../src/abi/ILeverAccAccount";
import { ILeverAccAccountFactoryABI } from "../../src/abi/ILeverAccAccountFactory";
import { ILeverAccFundVaultManagerABI } from "../../src/abi/ILeverAccFundVaultManager";
import { ILeverAccRegistryABI } from "../../src/abi/ILeverAccRegistry";
import { ILeverAccEconomicConfigABI } from "../../src/abi/ILeverAccEconomicConfig";
import { ILeverAccL1ReadAdapterABI } from "../../src/abi/ILeverAccL1ReadAdapter";
import { ICoreDepositWalletLikeABI } from "../../src/abi/ICoreDepositWalletLike";
import { CctpTokenMessengerV2ABI } from "../../src/abi/generated/CctpTokenMessengerV2";
import { IERC20ABI } from "../../src/abi/IERC20";
const abis: Abi[] = [
  CctpTokenMessengerV2ABI,
  ILeverAccAccountABI,
  ILeverAccAccountFactoryABI,
  ILeverAccFundVaultManagerABI,
  ILeverAccRegistryABI,
  ILeverAccEconomicConfigABI,
  IERC20ABI,
  ICoreDepositWalletLikeABI,
  ILeverAccL1ReadAdapterABI,
];
export const owner = "0x1111111111111111111111111111111111111111",
  account = "0x2222222222222222222222222222222222222222",
  agent = "0x3333333333333333333333333333333333333333",
  asset = "0x4444444444444444444444444444444444444444";
export const projectId = `0x${"ab".repeat(32)}` as const,
  hash = `0x${"ef".repeat(32)}`;
export async function mockBackend(
  page: Page,
  options: {
    hostPrompt?: boolean;
    mainnet?: boolean;
    noAccount?: boolean;
    readError?: boolean;
    lowGas?: boolean;
    noTopUp?: boolean;
    skipCreationTopUpCheck?: boolean;
    topUpError?: boolean;
    gasFunding?: boolean;
    delayedCreationReceipt?: boolean;
    unauthorized?: boolean;
    unbound?: boolean;
    dailyRatePpm?: number;
  } = {},
) {
  let creationConfirmed = !options.delayedCreationReceipt;
  if (options.delayedCreationReceipt)
    await page.exposeFunction("__completeCreation", () => {
      creationConfirmed = true;
    });
  const gasReceiver = "0x5555555555555555555555555555555555555555";
  const gasUsdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const gasTargetHash = `0x${"aa".repeat(32)}`;
  let gasSubmitted = false,
    gasReceived = false;
  const gasRecord = () => ({
    id: "gas-payment",
    created_at: new Date().toISOString(),
    system_core_account_address: gasReceiver,
    requested_usdc_amount_raw: "3000000",
    ...(options.mainnet
      ? { source_chain_id: 42161, source_tx_hash: hash }
      : {}),
    phase: gasReceived ? "success" : "processing",
    terminal: gasReceived,
    evm_tx_hash: gasTargetHash,
  });
  if (options.gasFunding) {
    await page.exposeFunction("__completeGasFunding", () => {
      gasReceived = true;
    });
  }
  await page.route(
    "https://protocol-service*/api/v1/gas-top-ups**",
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown;
      if (path.endsWith("/config"))
        data = {
          enabled: true,
          min_usdc_amount_raw: "1000000",
          max_usdc_amount_raw: "10000000",
          system_core_account_address: gasReceiver,
          arbitrum: {
            enabled: true,
            chain_id: 42161,
            usdc_address: gasUsdc,
            receiver_address: gasReceiver,
            confirmations: 2,
            min_usdc_amount_raw: "1000000",
            max_usdc_amount_raw: "10000000",
            daily_eoa_limit_raw: "10000000",
          },
        };
      else if (path.endsWith("/gas-payment")) data = gasRecord();
      else
        data = {
          items: options.gasFunding
            ? gasSubmitted
              ? [gasRecord()]
              : []
            : options.noTopUp
              ? []
              : [
                  {
                    requested_usdc_amount_raw: "3000000",
                    phase: "success",
                    terminal: true,
                  },
                ],
        };
      await route.fulfill({
        status: options.topUpError ? 503 : 200,
        json: { data },
      });
    },
  );
  const values: Record<string, unknown> = {
    primaryAccountOf: options.noAccount ? zeroAddress : account,
    user: owner,
    factory: options.mainnet
      ? "0x7211c8159449b99f0b7cdb6b7a9ea01b2e5c1ce7"
      : "0xe672fc21d0e429076b4386d20b5951eba214aedb",
    projectId: options.unbound ? `0x${"cd".repeat(32)}` : projectId,
    activeBorrowLotCount: 0n,
    projectBindingEpoch: 1n,
    userIntentNonce: 3n,
    executionApiWallet: options.unauthorized ? zeroAddress : agent,
    riskApiWallet: agent,
    executionWalletMode: 2,
    executionWalletAuthorizedProjectId: projectId,
    registry: asset,
    asset: options.mainnet
      ? "0xb88339CB7199b77E23DB6E890353E22632Ba630f"
      : "0x2B3370eE501B4a559b57D449569354196457D8Ab",
    transfer: true,
    approve: true,
    allowance: 0n,
    previewSafeUserClaimablePrimaryDirect: 1175495000n,
    readCoreUserExists: true,
    balanceOf: 1250000000n,
    l1ReadAdapter: asset,
    readCoreSpotBalanceState: {
      l1BlockNumber: 1n,
      total: 42550000000n,
      hold: 0n,
      entryNtl: 0n,
    },
    readCoreUserState: {
      l1BlockNumber: 1n,
      exists: true,
      accountValue: 280250000n,
      withdrawable: 280250000n,
      marginUsed: 0n,
      ntlPos: 0n,
      rawUsd: 280250000n,
    },
    createAccountNonce: `0x${"00".repeat(32)}`,
    createAccount: account,
    previewRepay: { repayableAmount: 100250000n },
    getAccountRuntimeStatus: {
      accountState: 1,
      pendingGasChargeDebtUsdc: 0n,
      borrowPrincipalOutstanding: 100000000n,
      badDebtAmount: 0n,
      availableAssetBalance: 750000000n,
      availableUserAssetBalance: 650000000n,
      payableInterestNow: 250000n,
      totalRealtimeDebtNow: options.unbound ? 0n : 100250000n,
      stopRequestedAt: 0n,
      settledAt: 0n,
    },
    previewBorrowCapacity: {
      projectId,
      theoreticalAdditionalBorrowAllowed: 2000000000n,
      finalAdditionalBorrowAllowed: 1800000000n,
      currentGlobalExposure: 100000000n,
      currentProjectExposure: 100000000n,
      currentProjectUserExposure: 100000000n,
      availableBorrowLiquidity: 100000000000n,
      riskApiWalletConfigured: true,
      coreUserActivated: true,
      borrowPaused: false,
      projectFrozen: false,
      accountFrozen: false,
      projectRegistered: true,
      blockerCode: 0,
    },
    effectiveBorrowRiskConfig: [1000000n, 100000000000n],
    economicConfig: asset,
    getCurrentBorrowRate: {
      version: 1n,
      updatedAt: 1n,
      dailyRatePpm: options.dailyRatePpm ?? 250_000,
      utilizationBps: 2500,
      cumulativeRatePpmSeconds: 0n,
      totalManagedAssets: 100000000000n,
      totalDebtOutstanding: 100000000n,
      idleLiquidity: 99000000000n,
    },
  };
  await page.exposeFunction("__mockSubmitted", (tx: { data: Hex }) => {
    for (const abi of abis) {
      try {
        const call = decodeFunctionData({ abi, data: tx.data });
        const args = call.args as any[];
        const runtime = values.getAccountRuntimeStatus as {
          availableAssetBalance: bigint;
          totalRealtimeDebtNow: bigint;
        };
        const spot = values.readCoreSpotBalanceState as { total: bigint };
        switch (call.functionName) {
          case "bindProject":
            values.projectId = args[0].toProjectId;
            values.projectBindingEpoch = args[0].nextProjectBindingEpoch;
            break;
          case "createAccount":
            values.primaryAccountOf = account;
            break;
          case "approve":
            values.allowance = args[1];
            break;
          case "depositFor":
            spot.total += args[1] * 100n;
            break;
          case "transfer":
            if (
              options.gasFunding &&
              String(args[0]).toLowerCase() === gasReceiver &&
              args[1] === 3_000_000n
            )
              gasSubmitted = true;
            runtime.availableAssetBalance += args[1];
            break;
          case "borrow":
            runtime.availableAssetBalance += args[0].minBorrowAmount;
            runtime.totalRealtimeDebtNow += args[0].minBorrowAmount;
            break;
          case "repay":
            runtime.availableAssetBalance -= args[0].requestedRepayAmount;
            runtime.totalRealtimeDebtNow -= args[0].requestedRepayAmount;
            break;
          case "sendCoreSpotToEvm":
            runtime.availableAssetBalance += args[1];
            spot.total -= args[1] * 100n;
            break;
          case "withdraw":
            runtime.availableAssetBalance -= args[0].requestedAmount;
            values.balanceOf =
              (values.balanceOf as bigint) + args[0].minPayoutAmount;
            break;
        }
        return;
      } catch {
        /* Try the next known ABI. */
      }
    }
  });
  await page.route(
    /https:\/\/(api\.example\.test\/.*|rpc\.hyperliquid-testnet\.xyz\/evm)/,
    async (route) => {
      const req = route.request(),
        url = req.url();
      if (req.method() === "OPTIONS") {
        await route.fulfill({
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
          },
        });
        return;
      }
      const body = req.postDataJSON();
      let data: unknown;
      if (
        url.endsWith("/rpc") ||
        url.endsWith("/arbitrum") ||
        url.endsWith("/evm")
      ) {
        const rpc = (request: {
          id: number;
          method: string;
          params?: any[];
        }) => {
          let result: unknown = "0x";
          if (request.method === "eth_call") {
            if (options.readError)
              return {
                jsonrpc: "2.0",
                id: request.id,
                error: { code: -32000, message: "RPC offline" },
              };
            let matched = false;
            for (const abi of abis) {
              try {
                const call = decodeFunctionData({
                  abi,
                  data: request.params![0].data,
                });
                let value = values[call.functionName!];
                if (
                  call.functionName === "previewRepay" ||
                  call.functionName === "previewWithdrawPlanPrimaryDirect" ||
                  call.functionName === "previewWithdrawablePrimaryDirect"
                ) {
                  const entry = abi.find(
                    (item) =>
                      item.type === "function" &&
                      item.name === call.functionName,
                  ) as any;
                  value = Object.fromEntries(
                    entry.outputs[0].components.map(
                      (item: { name: string; type: string }) => [
                        item.name,
                        item.type === "bool"
                          ? false
                          : item.type === "address"
                            ? account
                            : item.type === "bytes32"
                              ? `0x${"00".repeat(32)}`
                              : 0n,
                      ],
                    ),
                  );
                  const amount = (call.args as any[])[
                    call.functionName === "previewRepay" ? 0 : 1
                  ];
                  (value as Record<string, unknown>)[
                    call.functionName === "previewRepay"
                      ? "repayableAmount"
                      : "netPayoutAmount"
                  ] = amount ?? 0n;
                  if (call.functionName === "previewWithdrawPlanPrimaryDirect")
                    (value as any).requestedAmount = amount;
                  if (
                    call.functionName === "previewWithdrawablePrimaryDirect"
                  ) {
                    (value as any).userNetEquityNow = 1355500000n;
                    (value as any).accountNetValueNow = 1455750000n;
                  }
                }
                result = encodeFunctionResult({
                  abi,
                  functionName: call.functionName!,
                  result: value,
                });
                matched = true;
                break;
              } catch {}
            }
            if (!matched) result = "0x";
          } else if (request.method === "eth_getTransactionReceipt")
            result = !creationConfirmed
              ? null
              : {
                  transactionHash: hash,
                  transactionIndex: "0x0",
                  blockHash: `0x${"11".repeat(32)}`,
                  blockNumber: "0x1",
                  from: owner,
                  to: options.gasFunding
                    ? url.includes("arbitrum")
                      ? gasUsdc
                      : owner
                    : account,
                  cumulativeGasUsed: "0x5208",
                  gasUsed: "0x5208",
                  effectiveGasPrice: "0x1",
                  contractAddress: null,
                  logs:
                    options.gasFunding && url.includes("arbitrum")
                      ? [
                          {
                            address: gasUsdc,
                            topics: encodeEventTopics({
                              abi: IERC20ABI,
                              eventName: "Transfer",
                              args: { from: owner, to: gasReceiver },
                            }),
                            data: encodeAbiParameters(
                              [{ type: "uint256" }],
                              [3_000_000n],
                            ),
                            blockNumber: "0x1",
                            blockHash: `0x${"11".repeat(32)}`,
                            transactionHash: hash,
                            transactionIndex: "0x0",
                            logIndex: "0x0",
                            removed: false,
                          },
                        ]
                      : [],
                  logsBloom: `0x${"00".repeat(256)}`,
                  status: "0x1",
                  type: "0x2",
                };
          else if (request.method === "eth_blockNumber") result = "0x2";
          else if (request.method === "eth_chainId")
            result = url.includes("arbitrum")
              ? options.mainnet
                ? "0xa4b1"
                : "0x66eee"
              : options.mainnet
                ? "0x3e7"
                : "0x3e6";
          else if (request.method === "eth_estimateGas") result = "0x186a0";
          else if (request.method === "eth_gasPrice") result = "0x1";
          else if (request.method === "eth_getBalance")
            result =
              gasReceived || url.includes("arbitrum") || !options.lowGas
                ? "0xde0b6b3a7640000"
                : "0x0";
          return { jsonrpc: "2.0", id: request.id, result };
        };
        data = Array.isArray(body) ? body.map(rpc) : rpc(body);
      } else {
        throw new Error(`Unexpected API request: ${url}`);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    },
  );
  await page.route(
    /https:\/\/iris-api(-sandbox)?\.circle\.com\//,
    async (route) => {
      const fee = await page.evaluate(
        () => (window as any).__bridgeFee ?? "100000",
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          route.request().url().includes("/messages/")
            ? { messages: [] }
            : [1000, 2000].map((finalityThreshold) => ({
                finalityThreshold,
                minimumFee: 0,
                forwardFee: { high: fee },
              })),
        ),
      });
    },
  );
  await page.route(
    "https://api.hyperliquid-testnet.xyz/exchange",
    async (route) => {
      const body = route.request().postDataJSON();
      if (
        options.gasFunding &&
        body.action?.type === "sendAsset" &&
        body.action.destination === gasReceiver &&
        body.action.amount === "3"
      )
        gasSubmitted = true;
      if (
        body.action?.type === "sendAsset" &&
        body.action.destination === "0x2000000000000000000000000000000000000000"
      ) {
        values.balanceOf =
          (values.balanceOf as bigint) +
          BigInt(Math.round(Number(body.action.amount) * 1e6));
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", response: { type: "default" } }),
      });
    },
  );
  await page.route(
    /https:\/\/api.hyperliquid(-testnet)?\.xyz\/info/,
    async (route) => {
      const { type } = route.request().postDataJSON();
      const data: Record<string, unknown> = {
        spotClearinghouseState: {
          balances: [{ coin: "USDC", total: "425.50000000", hold: "0" }],
        },
        clearinghouseState: { withdrawable: "280.25" },
        extraAgents: [{ address: agent, validUntil: Date.now() + 600000 }],
        userRole: { role: "agent", data: { user: account } },
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data[type]),
      });
    },
  );
}
export async function mountMockWidget(
  page: Page,
  locale = "en",
  options: Parameters<typeof mockBackend>[1] = {},
  restoreBackend = false,
) {
  await page.goto("/examples-dist/examples/vanilla/");
  await page.addScriptTag({ url: "/dist/widget.js" });
  if (!restoreBackend) await mockBackend(page, options);
  await page.evaluate(
    ({
      owner,
      projectId,
      hash,
      locale,
      hostPrompt,
      mainnet,
      skipCreationTopUpCheck,
    }) => {
      document.body.innerHTML =
        '<main style="display:block;max-width:480px;margin:20px auto;padding:12px"><div id="test-widget"></div></main>';
      (window as any).events = [];
      (window as any).requests = [];
      let chainId = mainnet ? "0x3e7" : "0x3e6";
      const wallet = {
        request: async ({ method, params }: any) => {
          (window as any).requests.push({ method, params });
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [owner];
          if (method === "eth_chainId") return chainId;
          if (method === "eth_sendTransaction") {
            await (window as any).__mockSubmitted(params[0]);
            return hash;
          }
          if (
            (window as any).__rejectSignatureOnce &&
            method === "eth_signTypedData_v4"
          ) {
            (window as any).__rejectSignatureOnce = false;
            throw { code: 4001 };
          }
          if (hostPrompt && method === "eth_signTypedData_v4")
            return new Promise((resolve) => {
              const overlay = document.createElement("div");
              overlay.setAttribute("role", "dialog");
              overlay.setAttribute("aria-label", "Host wallet confirmation");
              overlay.style.cssText =
                "position:fixed;inset:30%;z-index:10000;background:white;padding:30px";
              const confirm = document.createElement("button");
              confirm.textContent = "Host confirm signature";
              confirm.onclick = () => {
                overlay.remove();
                resolve(`0x${"ab".repeat(64)}1b`);
              };
              overlay.append(confirm);
              document.body.append(overlay);
            });
          if (method === "personal_sign" || method === "eth_signTypedData_v4")
            return `0x${"ab".repeat(64)}1b`;
          if (method === "wallet_switchEthereumChain") {
            chainId = params[0].chainId;
            return null;
          }
          throw Error(method);
        },
        on() {},
        removeListener() {},
      };
      (window as any).testWallet = wallet;
      (window as any).testWidget = (window as any).LeverAcc.mountLeverAccWidget(
        document.querySelector("#test-widget"),
        {
          config: {
            network: mainnet ? "mainnet" : "testnet",
            arbitrumRpcUrl: "https://api.example.test/arbitrum",
            rpcUrl: "https://api.example.test/rpc",
            projectId,
            locale,
            skipCreationTopUpCheck,
          },
          wallet,
          onEvent: (event: any) => (window as any).events.push(event),
        },
      );
    },
    {
      owner,
      projectId,
      hash,
      locale,
      hostPrompt: options?.hostPrompt,
      mainnet: options?.mainnet,
      skipCreationTopUpCheck: options?.skipCreationTopUpCheck,
    },
  );
}
