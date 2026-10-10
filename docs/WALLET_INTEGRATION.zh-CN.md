# 钱包与完整流程接入

[English](WALLET_INTEGRATION.md) | **简体中文**

Widget 的链上读写使用 viem；宿主负责登录、钱包发现、连接、选择、断连和自己的项目授权服务。可以使用 wagmi 的 injected / WalletConnect connector，也可以使用 Privy 内嵌或外部钱包。无需安装 wagmi 或 Privy 才能使用基础 Widget；两者在本仓库中仅是示例开发依赖。

## wagmi

完整可运行示例：`examples/react/main.tsx`，使用 wagmi 3、TanStack Query 和 viem。

```tsx
import { useMemo } from "react";
import { useConnection } from "wagmi";
import { LeverAccWidget } from "@leveracc/widget";
import { walletFromWagmi } from "@leveracc/widget/wallets";
import { useWidgetWallet } from "@leveracc/widget/wallets/react";

function AccountWidget() {
  const { address, connector, isConnected } = useConnection();
  const create = useMemo(
    () =>
      isConnected && address && connector
        ? () => walletFromWagmi(connector, address)
        : undefined,
    [isConnected, address, connector],
  );
  const { wallet, error, loading } = useWidgetWallet(create);
  return (
    <>
      {error && <p role="alert">{error.message}</p>}
      {loading && <p>正在准备钱包…</p>}
      <LeverAccWidget
        config={config}
        wallet={wallet}
        onConnect={openYourWalletSelector}
      />
    </>
  );
}
```

`config` 为真实的 WidgetConfig；`openYourWalletSelector` 打开宿主的 connector 选择界面。宿主需要 `WagmiProvider` 和 `QueryClientProvider`，链配置包含 HyperEVM 998 / 999；测试网／主网提现分别对应 Arbitrum Sepolia 421614／Arbitrum One 42161。wagmi 2 使用 `useAccount()` 获取同类连接字段，`walletFromWagmi` 接口不变。

不要把 `chainId` 放进创建 adapter 的依赖：同一账户在多步流程中切链时必须保留钱包身份和在途操作。更换 connector、owner 或断连时才销毁旧 adapter。`useWidgetWallet` 会丢弃过时的异步 provider 并清理订阅；请 memoize 创建函数。

示例默认支持浏览器钱包。WalletConnect 需要自己的 `VITE_WALLETCONNECT_PROJECT_ID`；没有该配置就不展示该 connector。wagmi 的 EIP-6963 发现和重连由宿主管理，不由 Widget 扫描 `window.ethereum`。

## Privy

完整可运行示例：`examples/privy/main.tsx`。

复制 `.env.example` 为 `.env.local`，填写自己的 `VITE_PRIVY_APP_ID`，在 Privy 控制台允许当前站点 Origin，再启动开发服务。该 ID 不是服务端密钥；不要向前端放入 app secret。

```tsx
import { useMemo } from "react";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { usePrivyWidgetWallet } from "@leveracc/widget/wallets/react";

const { ready, wallets } = useWallets();
const { authenticated, login } = usePrivy();
const selected =
  ready && authenticated
    ? wallets.find(
        (w) => w.address.toLowerCase() === selectedOwner.toLowerCase(),
      )
    : undefined;
const { wallet, error } = usePrivyWidgetWallet(selected);
// <LeverAccWidget config={config} wallet={wallet} onConnect={() => login()} />
```

`usePrivyWidgetWallet` 保持同一 owner 的 adapter 稳定，同时使用 SDK 更新后的钱包方法，避免正常切链导致在途流程失效。宿主应明确选择 owner，不能自动拿 `wallets[0]` 替代已创建 LAAccount 的 owner。Privy adapter 调用选定钱包的 `switchChain()`，随后重新获取 `getEthereumProvider()` 并验证实际链和授权账户。Privy 支持链需包含 HyperEVM 与需要的 Arbitrum。

Widget 在钱包操作期间暂时退出原生模态顶层，避免浏览器把宿主的 Privy 登录/签名 UI 置为不可交互。无需为了穿透 Widget 弹窗而禁用钱包确认 UI。

## viem / 普通 JavaScript

```ts
import { walletFromViem } from "@leveracc/widget/wallets";
const adapter = await walletFromViem(walletClient, originalEip1193Provider);
const widget = mountLeverAccWidget(element, { config, wallet: adapter });
// 切换账户或销毁宿主连接时：
widget.destroy();
adapter.destroy();
```

传入已连接的 JSON-RPC WalletClient。此浏览器接入不支持私钥 local account 或 RPC 解锁账户。传入原 EIP-1193 provider 可转发实时账户、链及断连事件；只有 WalletClient 而没有 provider 时，宿主必须在身份变化时重建 adapter、更新 widget，不能依赖不存在的事件源。

## 项目授权与 Gas 服务

以下介绍未填写新创建开关时的兼容流程；独立模式见[创建前的 Gas 兑换与激活](#创建前的-gas-兑换与激活)。

钱包连接不等于项目交易授权。新建 LAAccount 并不自动生成项目 Execution Wallet 授权或设置 Risk Wallet。项目方须根据自己的服务契约实现这些操作；wagmi / Privy 本身无法提供项目方签名。

默认快速借入弹窗不显示账户设置说明或设置按钮。项目方须在自己的页面提供账户设置流程。`onAccountSetup` 和控制器的 `setupAccount()` 继续保留以兼容已有集成，但默认弹窗不会调用它们。链上前置条件未满足时仍会阻止借入。

Widget 默认内置 3 USDC 充值流程。可选回调让宿主覆盖充值或接入项目授权：

```tsx
<LeverAccWidget
  config={config}
  wallet={wallet}
  onConnect={openYourWalletSelector}
  onAccountSetup={async ({ owner, account, projectId, network, reasons }) => {
    await yourProjectOnboarding({
      owner,
      account,
      projectId,
      network,
      reasons,
    });
  }}
  onGasTopUp={async ({ owner, network }) => {
    await yourGasFundingFlow({ owner, network });
  }}
/>
```

回调中的 `yourProjectOnboarding` 和 `yourGasFundingFlow` 是接入方自己的实现，不是本包提供的服务。Widget 不处理登录 token、不接收项目私钥。默认情况下，创建账户会通过 `GET /api/v1/gas-top-ups?user_eoa=…` 查询当前 owner 的记录；需存在 `requested_usdc_amount_raw="3000000"`、`phase="success"`、`terminal=true` 的单笔记录，并且链上余额至少 0.01 HYPE。回调返回后重新检查两项条件，不以回调成功作为充值凭据。授权未生效仍会阻止借款。

默认按网络使用 `https://protocol-service.leveracc.xyz` 或 `https://protocol-service-testnet.leveracc.xyz`，可通过 `config.protocolServiceUrl` 覆盖。服务需允许宿主页跨域读取。历史资格来自服务端记录，不限制记录时间或来源链，不累计多笔付款。弹窗每 5 秒自动重试未满足的开户条件，避免重叠请求，无需“刷新状态”按钮。充值和开户前再次检查条件。

项目方可在 React 或嵌入式入口的 `config` 中设置以下配置（默认 `false`，仅接受布尔值）：

```ts
const config = {
  projectId,
  network: "mainnet",
  locale: "zh",
  skipCreationTopUpCheck: true,
} as const;
```

开启后，没有待处理内置付款时不请求付款历史，直接检测当前网络 HyperEVM 上 Fund wallet（owner EOA）的实时 HYPE 余额。达到 0.01 HYPE 即满足创建的资金条件，即使付款历史服务不可用也可创建；余额不足或 RPC 读取失败仍会阻止创建。提交创建前重新检查，配置或钱包变化会使旧请求结果失效。余额不足时保留内置 3 USDC 充值和 `onGasTopUp`，内置充值仍需要服务端充值路由配置；余额足够时跳过充值及回调。此配置不会将账户标记为已激活，项目方负责后续激活检测；签名、账户归属、项目绑定及后续操作的现有校验保持不变。

未配置 `onGasTopUp` 时：

- 主网读取 `/api/v1/gas-top-ups/config` 的 Arbitrum 路由，校验 chain ID 42161、原生 USDC 地址、收款地址和金额限额；切换主钱包至 Arbitrum，检查 3 USDC 和 ETH 余额，模拟并提交 USDC `transfer`。
- 测试网向配置中的 `system_core_account_address` 发送 3 USDC，来源与目标均为 HyperCore Spot，使用现有 owner 签名与切链校验。
- 返回交易 hash 或 Core 确认提交后发出 `operationSubmitted`（`action: "gasFunding"`）。保存待处理付款，自动核实来源转账、匹配的服务记录、发放回执及 HYPE 余额；重开或刷新后恢复。采用服务端轮询间隔，默认 5 秒。
- 明确拒签可重试。结果未知或待处理转账禁止重复付款；临时查询错误自动重试。后台终态失败保持付款锁定并显示原因。来源交易明确回滚后清除待处理记录。
- 广播前必须能够使用浏览器存储，以便恢复待处理转账。本地记录不构成资格证明；仅开启 `skipCreationTopUpCheck` 时，直接转入 HYPE 才能替代历史 3 USDC 记录要求。已有待处理内置付款仍查询服务端记录以跟踪状态。

配置 `onGasTopUp` 后使用宿主流程，仍执行服务端与 gas 复查。除非开启 `skipCreationTopUpCheck`，否则宿主流程需生成兼容的充值记录；开启后仅检查 gas 余额。

### 创建前的 Gas 兑换与激活

可独立配置 `creationGasConversionEnabled` 和 `creationAccountActivationEnabled`。两者仅接受布尔值，默认均为 `true`。

| Gas 兑换 | 账户激活 | 准备流程 |
| --- | --- | --- |
| `true` | `true` | 一次合并转账，支付 3 USDC |
| `true` | `false` | 独立兑换 Gas，支付 3 USDC |
| `false` | `true` | 独立激活付款，支付 1.1 USDC |
| `false` | `false` | 直接进入创建账户流程 |

仅激活账户的配置：

```ts
const config = {
  projectId,
  network: "mainnet",
  locale: "zh",
  creationGasConversionEnabled: false,
  creationAccountActivationEnabled: true,
} as const;
```

关闭 Gas 兑换后，创建资格检测与账户提交均不再要求固定的 0.01 HYPE 最低余额。实际交易模拟和钱包交易校验仍然生效。关闭的功能不需要对应的资格查询。两项都关闭时，无需付款服务即可创建账户；此前已提交的付款仍保留并单独核对，不会因已关闭功能的资格条件阻止创建。

省略两个新开关时，完整保留旧行为，包括 `skipCreationTopUpCheck: true` 仅检测 HYPE。显式填写任意一个开关后，另一个默认 `true`，此时 `skipCreationTopUpCheck` 仅跳过 Gas 付款历史，不能跳过已开启的激活准备。仅兑换模式读取 `/api/v1/gas-conversions`，仅激活模式读取 `/api/v1/account-activations`，合并模式继续使用 `/api/v1/gas-top-ups`。显式合并模式校验成功服务记录中的激活费用分配，Gas-only 记录不能作为合并激活的资格证明。

弹窗保留现有准备与创建步骤、按钮位置和自动轮询，仅按模式调整文案及金额；两项都关闭时隐藏准备步骤，仅显示创建账户步骤。不增加用户模式选择器。主网使用 Arbitrum USDC，测试网使用 HyperCore Spot。

独立模式需要额外的钱包消息签名：获取路由配置和 `/orders/challenge`，校验付款人、模式、来源、收款地址、金额、nonce、有效期及签名消息，签名后通过 POST `/orders` 创建订单，再进行转账。接口前缀为 `/api/v1/gas-conversions` 或 `/api/v1/account-activations`。应允许宿主页面向服务发送跨域 GET 和 JSON POST 请求。合并模式保留原来的直接转账，不增加订单签名。

订单创建成功不代表付款确认。组件查询 `/orders/{intent_id}` 及其关联的 `matched_top_up_id` 或 `matched_activation_id`。激活状态 `waiting_account`、`submitting`、`activated` 满足创建准备条件；`waiting_account` 表示付款已确认，等待账户创建后履行激活。服务也可通过 `already_activated` 确认已经激活。只有未付款订单或笼统的 `activation_pending` 状态不能放行创建。仅激活模式不会等待 HYPE 到账，也不会在创建前等待最终激活完成。Gas 兑换仍需至少 0.01 HYPE 和成功兑换证明；跳过历史检查的配置仅豁免兑换证明要求。

待处理付款记录保留模式、金额、订单 ID、关联记录 ID 及转账标识；旧记录按合并付款恢复。重新打开页面或拒绝转账后，可从服务恢复未过期订单。即将过期的订单需等待过期后才能替换，不得使用过期订单付款。提交结果未知的转账会持续锁定直至核对清楚，即使订单已经过期也不会直接重付。钱包、网络、服务地址或开关变化会使旧资格检测失效。跨标签页锁防止并发付款。创建提交前会复查与弹窗相同的条件。

`topUpGas()` 和 `onGasTopUp` 保持可用。回调新增可选的 `flow`（`combined`、`gas_only`、`activation_only` 或 `none`）与 `amountRaw` 字段，描述所选准备模式。回调覆盖当前模式的付款流程，并须产生对应的服务端证明。两项都关闭时不调用回调。回调正常返回本身不能证明已满足付款条件。

## 验证范围

本地测试覆盖 SDK 适配、owner 校验、SDK 切链、未知链添加、断连/异步清理、宿主钱包弹窗交互及资金流程。真实 Privy 登录、WalletConnect 会话和链上资金操作需要用户自己的 app/project 配置与钱包；构建或模拟测试通过不代表已完成线上联调。

参考官方接口：[viem Wallet Client](https://viem.sh/docs/clients/wallet)、[wagmi useConnect](https://wagmi.sh/react/api/hooks/useConnect)、[Privy 钱包连接](https://docs.privy.io/wallets/connectors/usage/connect-or-create)。示例 SDK 版本与相邻 dapp 对齐。
