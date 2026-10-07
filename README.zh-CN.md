# LeverAcc Widget

[English](README.md) | **简体中文**

[npm 接入指南](docs/NPM_INTEGRATION.zh-CN.md) · [钱包接入](docs/WALLET_INTEGRATION.zh-CN.md) · [发布流程](docs/RELEASING.zh-CN.md) · [独立 npm 示例](examples/npm/README.zh-CN.md)

独立的 React / JavaScript 账户与借贷组件，使用接入方提供的 EIP-1193 钱包。**不需要 v1 API、登录会话、Cookie 或后端账户注册。** 账户真值来自 Factory 与链上状态；Core 余额通过协议 read adapter 查询，首次入金中转通过 Hyperliquid SDK 签名执行。

无账户时显示创建 Onboarding；链上验证成功后显示顶部账户概览及可配置的充值、借款、还款、划转、提现按钮。所有业务流程在 Shadow DOM 内的弹窗中完成，支持中英文、明暗主题、移动端和键盘操作。

## npm 安装与发布

本机编译并发布到 npm 官方仓库：

```sh
npm login --registry=https://registry.npmjs.org/
pnpm publish:npm:dry-run  # 完整编译、测试和打包校验，模拟发布，不上传
pnpm publish:npm          # 完整校验后，将已校验的 .tgz 上传到 npm
```

也可使用 `npm run publish:npm`。读取当前版本，稳定版使用 `latest`，预发布版使用 `next`；不会自动升级版本或创建 Git tag。发布前需具备 `@leveracc` 权限，同版本不能重复发布。

可直接指定 npm 标签，覆盖默认的稳定版 `latest` / 预发布版 `next`：

```sh
pnpm publish:npm --tag beta
pnpm publish:npm --tag latest
pnpm publish:npm:dry-run --tag alpha
npm run publish:npm -- --tag beta
```

也支持 `--tag=beta`，可与 `--dry-run` 组合。缺失或空标签、重复参数及未知参数会在发布检查前报错。标签的 npm 合法性由 npm 校验。GitHub 自动发布仍按版本选择标签。

本地打包与独立 npm 集成示例：

```sh
pnpm publish:local       # 构建并生成 artifacts/*.tgz，不上传 registry
pnpm example:npm:setup   # 重新打包并用 npm 安装到 examples/npm
pnpm example:npm         # http://localhost:5174
```

示例提供 React／embed 切换、四套主题预览、语言选择及宿主钱包连接，仅从已安装的 npm 包导入。详细步骤见 [独立 npm 示例](examples/npm/README.zh-CN.md)。`pack:local` 与 `publish:local` 等价；从本机向 npm registry 发布仍遵循[正式发布流程](docs/RELEASING.zh-CN.md)。


```sh
npm install @leveracc/widget react react-dom
```

首次发布前可安装维护者提供的 `.tgz`。第三方项目请先阅读 [npm 接入指南](docs/NPM_INTEGRATION.zh-CN.md)（React、Next.js、Vue、JavaScript），维护者参见 [发布流程](docs/RELEASING.zh-CN.md)。

## 钱包接入与完整流程

提供 viem、wagmi、Privy 适配器和真实 SDK 示例，见 [钱包接入文档](docs/WALLET_INTEGRATION.zh-CN.md)。React 示例使用 wagmi 连接器，Privy 示例位于 `/examples/privy/`。`onConnect` 打开宿主钱包连接界面；可选 `onAccountSetup` 和 `onGasTopUp` 接入项目方授权与 Gas 服务，并在完成后验证链上状态。默认快速借入弹窗不显示账户设置说明或设置按钮，项目方须在自己的页面提供设置流程。`onAccountSetup` 和控制器的 `setupAccount()` 继续保留以兼容已有集成。借入仍须满足链上前置条件。基础组件不会强制宿主安装 wagmi / Privy。

## 接入

```tsx
import { LeverAccWidget, type WidgetConfig } from "@leveracc/widget";

const config: WidgetConfig = {
  projectId: "0x…", // 已注册项目的 bytes32：0x + 64 位十六进制
  network: "testnet",
  locale: "zh",
  theme: "dark",
  features: {
    tradingAccount: true,
    deposit: true,
    borrow: true,
    repay: true,
    transfer: true,
    withdraw: true,
  },
};

<LeverAccWidget
  config={config}
  wallet={hostWalletProvider}
  onEvent={handleEvent}
/>;
```

React / ReactDOM 为 peer dependencies，支持 React 18.3 与 19。不要求宿主安装 Wagmi、Privy 或 React Query provider。更新 props 即可更新配置；React ref 提供 `refresh(): Promise<void>`。

普通 JavaScript / Vue 项目使用自带 React 的入口：

```js
import { mountLeverAccWidget } from "@leveracc/widget/embed";
const widget = mountLeverAccWidget(document.querySelector("#widget"), {
  config,
  wallet: hostWalletProvider,
  onEvent(event) {
    console.log(event);
  },
});
widget.update({ config: { ...config, features: { borrow: false } } });
await widget.refresh();
widget.destroy(); // 可重复调用
```

无构建工具时托管 `dist/widget.js`，使用全局 `LeverAcc.mountLeverAccWidget`。配置更新是整体替换，不是深层合并。钱包应实现 `request` 与 `accountsChanged` / `chainChanged` 的监听和取消监听；没有事件接口时，宿主应在身份变化后更新 provider。

## 配置

| 字段                          | 默认值 / 约束              | 含义                                                                     |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `projectId`                   | 必填 bytes32               | 已注册项目 ID                                                            |
| `network`                     | 必填 `mainnet` / `testnet` | HyperEVM 999 / 998，与 Core 网络成组选择                                 |
| `protocolServiceUrl` | 按网络预设 | Protocol Service 地址，用于查询创建前的历史充值记录 |
| `skipCreationTopUpCheck` | `false` | 跳过创建账户的 3 USDC 付款历史校验，仍要求 Fund wallet 至少有 0.01 HYPE；仅接受布尔值 |
| `rpcUrl`                      | 网络预设                   | 同网络 HyperEVM RPC                                                      |
| `arbitrumRpcUrl` | 对应网络的 Arbitrum 预设 | 主网使用 Arbitrum One（42161）；测试网使用 Arbitrum Sepolia（421614） |
| `locale`                      | `en`                       | `en` / `zh`                                                              |
| `theme`                       | `dark`                     | `light` / `dark`                                                         |
| `primaryColor`                | `#0099ff`                  | 六位 HEX 主色，兼容旧接入；可由 `colors.primary` 覆盖 |
| `colors` | 按主题预设 | `Partial<WidgetColors>`，主面板与所有弹窗的语义配色 |
| `features`                    | 六项全部开启               | `tradingAccount`、`deposit`、`borrow`、`repay`、`transfer`、`withdraw`，允许全部关闭 |
| `borrow.termSeconds`          | `604800`                   | 协议借款期限，正 uint32                                                  |
| `borrow.maxCoreReturnFeeUsdc` | `"1"`                      | Core 回款费用上限                                                        |
| `borrow.expiryWindowSeconds`  | `900`                      | intent 有效期，1–3600 秒                                                 |
| `arbitrumWithdrawalEnabled`   | `true`                    | 主网与测试网均支持，需确认部署支持 Circle forwarding                                 |

设置 `config.skipCreationTopUpCheck: true` 后，创建账户仅校验当前网络 HyperEVM 上 Fund wallet（owner EOA）的实时余额是否至少为 0.01 HYPE，没有待处理内置付款时不请求付款历史；付款历史服务不可用不会阻止创建，但余额不足或余额读取失败仍会阻止。余额不足时仍可使用内置 3 USDC 充值或 `onGasTopUp`；内置充值需要可用的充值路由配置。余额足够时跳过充值及回调。配置变更会使旧检测结果失效。创建成功不代表已激活，项目方负责后续激活检测；现有签名、账户归属、项目绑定及后续操作校验保持不变。示例见[钱包集成](docs/WALLET_INTEGRATION.zh-CN.md)。

移除了旧版 `apiBaseUrl`、`indexerUrl` 与 `defaultTab`；`protocolServiceUrl` 用于创建前充值记录查询。入口区不自动打开业务弹窗。功能关闭后，对应弹窗关闭，控制器阻止新签名和提交；已提交交易继续跟踪。

### 第三方集成的网络部署

`network` 为每个 Widget 实例选择下列协议合约。地址内置于包中，`WidgetConfig` 不提供合约地址覆盖字段。协议部署更新时需要更新包版本。自定义 RPC URL 只改变请求端点，必须连接所选网络。外部 Arbitrum 充值会在读取余额或请求签名前拒绝链 ID 不匹配的 RPC。

| 配置 | `mainnet` | `testnet` |
| --- | --- | --- |
| HyperEVM 链 ID | `999` | `998` |
| Arbitrum 链 ID | `42161` | `421614` |
| AccountFactory | `0x7211c8159449b99f0b7cdb6b7a9ea01b2e5c1ce7` | `0xe672fc21d0e429076b4386d20b5951eba214aedb` |
| FundVaultManager | `0x03524982bba6763d045d1a44f3c090ffcf39774b` | `0x99d8f178af00b229cbc00676f42f0a492bdef52c` |
| CoreDepositWallet | `0x6b9e773128f453f5c2c60935ee2de2cbc5390a24` | `0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206` |
| Protocol Service | `https://protocol-service.leveracc.xyz` | `https://protocol-service-testnet.leveracc.xyz` |

请提供所选网络中已注册的项目方 `projectId`，不要复制 LeverAcc dapp 的自营策略项目 ID。Widget 会将宿主项目 ID 传入开户、项目绑定和借款流程；项目注册、执行钱包及风险钱包授权由项目方负责。已有账户可能需要先绑定项目才能借款。切换网络不会自动注册或迁移项目。

账户的 Registry 和 Manager 的 USDC 资产从链上读取，不固定 FundVault 代际地址。主网与测试网实例可以共存；切换某个实例时，应传入完整配置，包含目标网络的项目 ID 及所需的自定义 RPC／服务 URL。省略这些 URL 会使用新网络的默认值。测试网 Gas 充值使用 HyperCore，主网 Gas 充值使用 Arbitrum One。测试网外部 Fund 充值和提现使用 Arbitrum Sepolia，但不支持通过 CCTP 直接转发到 HyperCore。

## 账户与资金流程

- Fund 为宿主钱包的 owner EOA；Trade 为 Factory `primaryAccountOf(owner)` 返回的 LAAccount。读取失败显示错误，不视作无账户。
- 默认创建要求 Protocol Service 中成功的单笔 3 USDC 历史充值记录及至少 0.01 HYPE。弹窗每 5 秒自动检查未满足的条件，就绪后显示“签名并创建账户”。签名前再次检查条件，提交后每 3 秒检查回执，验证 Factory 映射及账户的 owner、factory、project 和 binding epoch，确认后显示完成。不提供手动刷新按钮。主网充值转账 Arbitrum 原生 USDC，测试网使用 HyperCore Spot；收款地址来自 Protocol Service 配置。`onGasTopUp` 覆盖内置充值流程，之后自动检查状态。
- 顶部三栏展示账户地址与复制、自有净值（抵押品）／可用交易余额／债务、负债比例（风险指数）。抵押品取 HyperEVM USDC + HyperCore 自有资金（详见下文）；可用交易余额为 Spot USDC `total - hold`，最低为零，为零时不回退到 Perps；风险指数为债务 / `accountNetValueNow`，并非清算阈值。指标读取失败显示 `—`。
- **Withdraw 提现**：独立 `withdraw` 开关，选择 Fund 或 Trade 来源并提现至 owner 的 Arbitrum 钱包。主网对应 HyperEVM 999 → Arbitrum One 42161；测试网对应 HyperEVM 998 → Arbitrum Sepolia 421614。默认 RPC、原生 USDC、Circle 合约、费用 API 和 intent 链 ID 均跟随 `network`。Trade MAX 为 `max(0, min(safeUserClaimable, EVM + max(Core Spot - 0.005 USDC, 0) - payableInterestNow))`。Core Spot 使用 Hyperliquid spot API，将 total 和 hold 分别截断到六位小数后相减。补足 EVM 时同时预留利息与提现金额。`arbitrumWithdrawalEnabled` 默认启用；不支持的部署可显式设为 `false`，界面会说明不可用原因。预览仍须允许足额转出。Fund 直接通过 Circle 授权、跨链。每笔交易发出后即结束，不恢复历史交易。打开或重新打开弹窗、提交交易后，重新读取来源余额／额度和 owner 的目标网络 USDC 余额。Trade 显示“可提现”，Fund 显示钱包余额。读取失败显示不可用，不视作零余额；重新打开弹窗可重试。费用参数在当前控件生命周期内按网络和方向缓存，输入金额时本地计算，不刷新余额或禁用输入框。提交前重新核验费用；费用上涨需重新确认。提交状态不占用提现弹窗布局，错误通过悬浮提示展示。最新费用和到账金额更新在原有字段中，通过主按钮确认下一次尝试，不显示独立核对区块。取消钱包确认后保留当前步骤，关闭并重新打开弹窗也能继续，不会重复已提交的步骤。
- 创建后的 TradeAccount 使用顶部静态交易账户卡展示地址、抵押品、已借款、交易可用额及风险指标。`features.tradingAccount` 控制地址复制按钮；抵押品 info 支持 hover、键盘和触屏查看 HyperEVM / HyperCore 分布。不下单，不创建、刷新或配置 Execution/Risk API Wallet。
- 项目切换须明确确认；负债、借款批次、待结算 Gas 债务或生命周期动作会阻止切换。
- **Account Transfer：Fund → Trade** 对齐 dapp：必要时先授权 Core Deposit Wallet，再 `depositFor` 到 Trade Core Spot。首次 Core 激活时经过 owner Core 中转；owner Core 必须已激活且保留至少 1.005 USDC，转入金额须大于 1 USDC，最低到账扣除 1 USDC 激活费用。
- **Account Transfer：Trade → Fund** 优先使用 Trade EVM；不足部分从 Core Spot 回 EVM，到账后再签名提现至 owner HyperEVM。可用 Core 余额扣除 0.005 USDC dust。每个需要钱包的后续步骤均显示“继续划转”。
- 账户详情及其“其他账户划转”、全额还款快捷入口已移除；协议层划转和还款 API 仍保留。
- 充值支持 owner HyperCore Spot → owner HyperEVM Fund，以及 Arbitrum → owner HyperEVM Fund（主网：Arbitrum One 42161 → HyperEVM 999；测试网：Arbitrum Sepolia 421614 → HyperEVM Testnet 998）。测试网可在 Deposit 弹窗选择“外部充值”，使用 Arbitrum Sepolia 原生测试 USDC 和 ETH 支付 gas；费用查询使用 Circle sandbox，授权和跨链合约均匹配测试网。原有 Fund → Trade EVM 的控制器方法保留；主界面通过 Account Transfer 为 Trade 充值。
- 借款使用链上额度、风险参数、nonce 和费率版本；输入金额后在原表单内显示利率、期限与费用上限，费率变化需重新确认。借入 USDC 到达 Trade EVM。
- 还款使用 Trade EVM 余额；全额还款包含 0.1% 利息授权缓冲，实际扣款由实时债务限制。余额不足时提示先划转。
- 所有交易返回 hash 或 Core 确认提交后发出 `operationSubmitted`，提交不代表执行成功。开户及其 Gas 充值额外跟踪确认和到账；其他交易流程仍在提交时结束。

## 事件与恢复

账户骨架屏仅在当前钱包／项目／网络上下文首次读取时显示。后台刷新保留现有内容，直到新数据返回；切换上下文会清除之前的账户数据。

交易失败、本地操作错误、账户读取失败、账户创建错误、提现重新报价错误和最低借款金额校验使用可关闭的浮动提示，五秒后自动消失，不占用布局空间。首次账户读取失败会禁用交易入口；后台刷新失败保留上次账户数据，提交时仍重新检查实时条件。

弹窗不显示交易状态块和交易浏览器链接，保留按钮进度及必要的多步操作引导。最后一笔交易发出后，表单清空金额、全额还款选项及临时输入提示，保留所选路径。授权和中间步骤、钱包取消及失败均保留输入，以便继续或重试。失败通过悬浮提示显示错误并允许重试；`onEvent` 提供 `operationProgress`、`operationSubmitted` 和 `error` 供宿主处理。

事件包含项目、网络、已知 owner / account，以及操作的 `operationId`、`action`、`stage` 和已知 hash。`operationSubmitted` 的阶段为 `submitted`，每笔提交仅发送一次；`action: "gasFunding"` 表示内置 Gas 充值。`awaitingAction` 表示可以手动继续或重试下一步，不表示到账。旧 `operationSuccess`、`success`、`confirming`、`bridging`、`settling` 类型保留并弃用，不再发送；接入方须将提交反馈迁移到 `operationSubmitted`。

缺少链上交易授权、风险钱包、项目绑定或 Core 激活时显示具体阻塞原因，并发出 `accountActionRequired`。宿主可自行处理后调用 `refresh()`，widget 不调用宿主业务 API。

开户和内置 Gas 充值在 localStorage 保存待处理交易标识，按网络、服务及 owner 隔离，开户还按项目隔离；重开或刷新页面后恢复核实。广播前必须能够使用存储。待处理充值验证来源转账日志、匹配的服务端状态、HYPE 发放回执及余额；本地记录不是付款证明。旧交易清理保留这些新记录。其他交易仍只保存在内存中。实例锁与 Web Locks 防止并发提交。

开户或 Gas 充值提交结果未知时，自动检查继续进行，同时禁止重复发送。临时 RPC 或服务错误会自动重试查询，不重发交易；后台终态失败显示原因并保持付款锁定。明确拒签可重试，明确回滚会清除对应待处理记录。快照的 `creationPending` 和 `creationFundingPending` 表示开户和充值待确认状态。控制器的 `creationReadiness()` 还返回 `creating` 以及 funding 的 `state`、`error` 和 `pollAfter`（毫秒）。其他交易的重试行为不变。

## 开发与验证

```sh
pnpm install
pnpm build
pnpm dev
pnpm test
pnpm build:examples
pnpm test:browser
```

示例页面从 `dist` 导入，源码更新后需先构建。浏览器首次运行可安装 Chromium：`pnpm exec playwright install chromium`。自动化验证使用模拟钱包、RPC、Core 与 Circle 服务，不提交真实资金交易。

`pnpm abi:sync` 从相邻 `leveracc-hyperevm-protocol` 的 ABI / out 产物同步协议 ABI，包括 Core Deposit Wallet 接口；安装包和构建不依赖相邻仓库。网络地址与交互参考 `../leveracc-dapp`，未修改 dapp、服务端或合约。推送匹配版本的 `v*` tag 会触发 npm 发布，详见 [发布流程](docs/RELEASING.zh-CN.md)；不自动部署网站。

### UI 与参考项目

默认弹窗采用相邻 dapp 的视觉规范和对应操作步骤：创建账户 440px、快捷借款 448px、资金操作 512px；保留 `theme` / `primaryColor` 配置及 Shadow DOM 隔离。主面板按嵌入容器宽度自适应，最大宽度为 720px：小于 360px 时指标与操作分行，640px 起指标和风险区并排；创建入口保留原布局。弹窗根据视口居中，窄屏缩小内边距、换行资金卡内容，并在短屏内部滚动。字体与图标已打包，许可在 `docs/licenses/`。

- 充值：Arbitrum → owner Fund（HyperEVM），或 owner HyperCore Spot → owner Fund；Core 路线保留 0.005 USDC。
- 提现：来源为 Fund 或 Trade，目标为 owner 在 Arbitrum 的钱包。Fund 先授权 Circle，再发起跨链；Trade 默认启用，可通过 `arbitrumWithdrawalEnabled: false` 关闭，不足时先从 Core Spot 补足 Trade EVM，之后显式继续跨链。合约限制导致无法足额转出时阻止提交。
- Fund ↔ Trade 保留在划转入口；不恢复历史内部提现记录。底层原有方法没有移除，`TransferRoute` 新增 `fundToArbitrum`。
- 报价在表单内显示，费用上涨需重新确认。授权通过 `operationSubmitted` 的 `action: "bridgeApproval"` 报告已发出，不代表授权已生效或提现到账。
- 内置充值需要来源网络的 3 USDC；主网还需 Arbitrum ETH 支付 gas。待处理转账可恢复且禁止重复发送。充值状态采用服务端轮询间隔，默认 5 秒。除非开启 `skipCreationTopUpCheck`，否则直接转入 HYPE 不能替代历史充值资格；开启该选项后，已有待处理内置付款仍通过服务端记录跟踪。

视觉对照使用参考仓库的真实组件及固定测试数据，不启动其后端、不修改参考仓库：

```sh
node scripts/build-ui-reference.mjs
LEVERACC_REFERENCE=1 pnpm exec playwright test reference-comparison.spec.ts
```

需要已安装依赖的相邻 `leveracc-dapp`；普通安装、构建和 `pnpm check` 不依赖它。对照输出位于 `test-results/reference-*.png` 与 `test-results/widget-*.png`。账户级还款使用链上本金、利息及总债务；未提供历史借款记录时，原始金额显示 `--`。账户卡为静态展示，仅保留地址复制；不再提供账户详情弹窗及其中的全额还款快捷入口。抵押品总额采用 HyperEVM USDC + HyperCore 自有资金，info 浮层展示两层分布；HyperCore 优先非零 Spot USDC 总额，否则采用 Perps account value，扣除实时债务并以零为下限。数据读取使用骨架屏，失败显示不可用状态。界面不再提供 Refresh status 按钮，宿主 refresh() API 及自动刷新仍保留。借款输入金额后补充展示本次签名涉及的利率、期限与费用上限。

### 语言配置与动态更新

组件支持 `locale: "en" | "zh"`，省略时使用英文。语言由接入方控制，组件内没有语言切换按钮。仅更新语言会保留打开的弹窗、输入金额及操作进度。

React 使用新的配置对象更新属性：

```tsx
const [config, setConfig] = useState<WidgetConfig>({
  projectId,
  network: "testnet",
  locale: "en",
});
// 宿主应用切换语言时：
setConfig(current => ({ ...current, locale: "zh" }));
// 渲染：<LeverAccWidget config={config} wallet={wallet} />
```

原生 JavaScript 使用实例更新；传入完整配置，保留原有网络与项目设置：

```js
let config = { projectId, network: "testnet", locale: "en" };
const widget = mountLeverAccWidget(element, { config, wallet });
config = { ...config, locale: "zh" };
widget.update({ config });
```

React 与原生 JS 示例页均提供宿主侧语言选择。账户划转界面仅提供资金账户与交易账户双向互转；层间划转控制器接口继续兼容。


### 平台主题配色


#### 常用主题预设

主入口和 `@leveracc/widget/embed` 均导出 `widgetThemes`、`WidgetTheme` 和 `WidgetThemeName`。预设包含完整的 `theme` 与 `colors`，可直接展开到配置中：

| 预设 | 模式 | 风格 |
| --- | --- | --- |
| `widgetThemes.light` | 亮色 | 白色面板、蓝色主按钮，保持默认亮色外观 |
| `widgetThemes.dark` | 暗色 | 深灰面板、蓝色主按钮，保持默认暗色外观 |
| `widgetThemes.midnight` | 暗色 | 深海军蓝背景、浅蓝按钮与深色按钮文字 |
| `widgetThemes.lavender` | 亮色 | 淡紫背景、紫色主按钮 |

```ts
import { widgetThemes, type WidgetConfig } from "@leveracc/widget";

const config: WidgetConfig = {
  projectId,
  network: "testnet",
  ...widgetThemes.dark,
};

// 亮色：
const lightConfig = { ...config, ...widgetThemes.light };

// 在预设基础上覆盖主色：
const customConfig = {
  ...config,
  ...widgetThemes.midnight,
  colors: { ...widgetThemes.midnight.colors, primary: "#a78bfa" },
};
```

React 运行时切换：

```tsx
// name 的类型为 WidgetThemeName：light | dark | midnight | lavender
setConfig(current => ({ ...current, ...widgetThemes[name] }));
```

embed 运行时切换：

```js
import { widgetThemes } from "@leveracc/widget/embed";

config = { ...config, ...widgetThemes.light };
widget.update({ config });
// 使用全局脚本时，同样可访问 LeverAcc.widgetThemes.light。
```

切换时同时展开预设的 `theme` 和 `colors`，即可替换上一套配色并保留项目、网络等配置。预设是只读对象；请通过展开创建自定义配色。预设包含 `colors.primary`，因此覆盖主色时请使用该字段，而非 `primaryColor`。只需默认明暗模式时，仍可直接设置 `theme: "light"` 或 `theme: "dark"`，并移除旧的 `colors` 覆盖。

React、vanilla 和已配置 App ID 的 Privy 示例页均在组件预览上方提供主题选择器，可即时切换这四套预设。


React 与 embed 入口均导出 `WidgetColors`。通过 `config.colors` 部分覆盖默认配色，所有值必须为六位 HEX（`#RRGGBB`，大小写均可）；不支持 CSS 变量、颜色名称或带透明度的 HEX。非法值会抛出 `INVALID_CONFIG`，错误信息包含对应字段。透明背景、悬停、遮罩和阴影透明度由组件派生。

| 字段 | 用途 | light 默认 | dark 默认 |
| --- | --- | --- | --- |
| primary | 主按钮、链接、强调与焦点 | #0099ff | #0099ff |
| surface | 主面板、卡片及普通弹窗底色 | #ffffff | #171a20 |
| background | 借还款弹窗及次级背景 | #f5f7fa | #080b0d |
| subtle | 柔和底色、选中态和派生卡片背景 | #edf1f5 | #22272f |
| border | 边框与骨架屏 | #dfe7ef | #232a34 |
| text | 主要文字 | #192c43 | #f7f7f8 |
| textMuted | 次要文字 | #63758a | #788697 |
| success | 成功状态 | #22c55e | #22c55e |
| danger | 错误、风险和负债指标 | #c93636 | #f65959 |
| warning | 创建账户充值按钮和步骤提示 | #ffd700 | #ffd700 |
| info | 创建账户充值说明 | #0099ff | #0099ff |
| debt | 还款金额强调 | #ff4d6d | #ff4d6d |
| onPrimary | 主色按钮、步骤文字 | #ffffff | #ffffff |
| onSuccess | 成功按钮、完成步骤文字 | #ffffff | #ffffff |
| onWarning | 创建账户充值按钮文字 | #000000 | #000000 |
| badgeText | 账户、推荐和初始步骤徽章文字 | #080b0d | #080b0d |
| sliderTrack | 借款滑条未填充区域 | #334155 | #334155 |
| overlay | 弹窗遮罩（50% 透明混合） | #000000 | #000000 |
| shadow | 弹窗、下拉菜单及提示阴影 | #000000 | #000000 |

主色优先级为 `colors.primary → primaryColor → #0099ff`。未提供的字段使用所选 `theme` 的默认值；默认主题仍为 `dark`。代币和链的品牌图标保持原色。

React 示例（由平台主题切换回调调用 `applyPlatformTheme`）：

```tsx
import { useState } from "react";
import { LeverAccWidget, type WidgetConfig } from "@leveracc/widget";

function PlatformWidget({ baseConfig }: { baseConfig: WidgetConfig }) {
  const [config, setConfig] = useState(baseConfig);
  function applyPlatformTheme(theme: "light" | "dark") {
    setConfig(current => ({
      ...current,
      theme,
      colors: theme === "light"
        ? { primary: "#7438cc", surface: "#faf7ff", onPrimary: "#ffffff" }
        : undefined,
    }));
  }
  return <>
    <button onClick={() => applyPlatformTheme("light")}>平台浅色</button>
    <button onClick={() => applyPlatformTheme("dark")}>默认深色</button>
    <LeverAccWidget config={config} />
  </>;
}
```

embed 示例（`config` 为现有完整配置）：

```js
function applyPlatformTheme(theme) {
  config = {
    ...config,
    theme,
    colors: theme === "light"
      ? { primary: "#7438cc", surface: "#faf7ff", onPrimary: "#ffffff" }
      : undefined,
  };
  widget.update({ config });
}
```

更新时传入完整 `config`；新的 `colors` 替换旧覆盖，不做跨更新深度合并。移除某字段即可恢复其主题默认值，移除 `colors.primary` 后仍会回退到 `primaryColor`（若提供）。React 请传入新的配置对象。仅换色不会关闭当前弹窗、清空输入或重新发起账户读取；各 widget 实例相互隔离。平台负责选择明暗模式和搭配文字对比色，组件不自动检测系统主题。可运行的 React 和 vanilla 示例均提供主题切换选项。
