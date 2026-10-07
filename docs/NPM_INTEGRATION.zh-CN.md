# 通过 npm 接入

[English](NPM_INTEGRATION.md) | **简体中文**

可运行的 [独立 npm 示例](../examples/npm/README.zh-CN.md)：根目录执行 `pnpm example:npm:setup`、`pnpm example:npm`，打开 http://localhost:5174。通过安装真实压缩包展示 React／embed、四套主题和语言切换。

本指南面向在自己项目中安装 `@leveracc/widget` 的接入方。发布维护见 [发布流程](RELEASING.zh-CN.md)，钱包 SDK 与授权服务见 [钱包接入](WALLET_INTEGRATION.zh-CN.md)。

## 安装与入口

包发布到 npm 后执行（首次发布前可使用维护者提供的 `.tgz` 替换包名）：

```sh
npm install @leveracc/widget react react-dom
# 或 pnpm add @leveracc/widget react react-dom
```

React / ReactDOM 版本必须一致，支持 18.3.1 或 19。已有 React 的项目保留满足范围的版本即可。包为 ESM，面向支持 ES2022、Shadow DOM、dialog 的现代浏览器；不提供 CommonJS `require()` 入口。TypeScript 推荐 `moduleResolution: "Bundler"`。无需额外导入 CSS，字体、图标和样式随包提供。

| 入口 | 用途 |
| --- | --- |
| `@leveracc/widget` | React 组件、ref 和公共类型，复用宿主 React |
| `@leveracc/widget/embed` | Vue / 普通 JavaScript 挂载，自带 React 运行时 |
| `@leveracc/widget/wallets` | viem、wagmi、Privy 钱包适配器 |
| `@leveracc/widget/wallets/react` | React 钱包适配 hooks |
| `@leveracc/widget/widget.js` | 自带依赖的浏览器脚本，全局 `LeverAcc` |

即使使用 embed，当前包仍声明 React peer dependencies，安装命令保持一致。无需安装 wagmi、Privy、React Query；仅选择这些钱包方案时安装对应 SDK。不要从 `dist` 或 `src` 深层导入。

开始前须取得目标网络中**已注册的 projectId**（bytes32，`0x` 加 64 位十六进制），准备宿主的钱包连接入口。任意拼接的 ID 不能用于真实业务。测试网为 HyperEVM 998，主网为 999；提现分别对应 Arbitrum Sepolia 421614 和 Arbitrum One 42161。项目注册、交易授权和 Risk Wallet 配置由项目方负责，详见钱包文档。

## React

以下组件接收宿主已经选择的钱包与连接方法，可直接加入业务页面：

```tsx
import { useRef } from "react";
import {
  LeverAccWidget,
  type LeverAccWidgetRef,
  type WalletProvider,
  type WidgetConfig,
  type WidgetEvent,
} from "@leveracc/widget";

export function AccountPanel({ projectId, wallet, connect }: {
  projectId: WidgetConfig["projectId"];
  wallet?: WalletProvider;
  connect: () => void | Promise<void>;
}) {
  const ref = useRef<LeverAccWidgetRef>(null);
  const config: WidgetConfig = {
    projectId,
    network: "testnet",
    locale: "zh",
    theme: "dark",
  };
  function onEvent(event: WidgetEvent) {
    if (event.type === "error") console.error(event.code, event.message);
    if (event.type === "operationSubmitted") console.log(event.action, event.hash);
  }
  return <LeverAccWidget ref={ref} config={config} wallet={wallet}
    onConnect={connect} onEvent={onEvent} />;
}
```

`wallet` 是 EIP-1193 provider（`request` 及账户／链事件订阅），不是钱包地址或 signer。组件不主动扫描浏览器钱包；连接由宿主触发并把 provider 写入 props，断连时传入 `undefined`。wagmi / Privy 用户使用[适配器示例](WALLET_INTEGRATION.zh-CN.md)，不要把 SDK 的 client 对象直接当 provider。

改变语言、主题或功能时传入新的完整 `config` 对象。`features` 中未指定的功能默认开启。宿主完成链上授权后可调用 `await ref.current?.refresh()`；组件卸载时自动清理。

### Next.js App Router

在客户端组件文件顶部添加 `"use client"`。钱包访问放在 effect 或点击事件中，避免渲染时读取 `window`。如宿主的钱包 SDK 不能参与服务端渲染，可在客户端包装文件中禁用 SSR：

```tsx
"use client";
import dynamic from "next/dynamic";
export const AccountPanel = dynamic(
  () => import("./AccountPanel").then((m) => m.AccountPanel),
  { ssr: false },
);
```

上面的 `AccountPanel.tsx` 使用 React 示例。provider 和回调必须在客户端创建，不能从 Server Component 序列化传入。

## 普通 JavaScript

```js
import { mountLeverAccWidget } from "@leveracc/widget/embed";

// element、projectId、wallet、connect 由宿主提供。
export function mountAccount(element, projectId, wallet, connect) {
  let config = { projectId, network: "testnet", locale: "zh" };
  const widget = mountLeverAccWidget(element, {
    config, wallet, onConnect: connect,
    onEvent: (event) => console.log(event),
  });
  return {
    setLocale(locale) {
      config = { ...config, locale };
      widget.update({ config });
    },
    setWallet(wallet) { widget.update({ wallet }); },
    refresh: () => widget.refresh(),
    destroy: () => widget.destroy(),
  };
}
```

先把容器插入 DOM，再挂载；每个容器只挂载一次。离开页面调用 `destroy()`，可重复调用。`update()` 的 `config` 是整体替换，不做深层合并；`update({ wallet: undefined })` 表示断连。卸载不取消已经提交的链上交易。

## Vue 3

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { mountLeverAccWidget, type WidgetConfig, type WidgetHandle,
  type WalletProvider } from "@leveracc/widget/embed";

const props = defineProps<{
  config: WidgetConfig;
  wallet?: WalletProvider;
  connect: () => void | Promise<void>;
}>();
const container = ref<HTMLElement>();
let widget: WidgetHandle | undefined;
onMounted(() => {
  widget = mountLeverAccWidget(container.value!, {
    config: props.config, wallet: props.wallet, onConnect: () => props.connect(),
  });
});
watch(() => props.config, (config) => widget?.update({ config }), { deep: true });
watch(() => props.wallet, (wallet) => widget?.update({ wallet }));
onBeforeUnmount(() => widget?.destroy());
</script>

<template><div ref="container" /></template>
```

Nuxt 中放在客户端组件或 `ClientOnly` 内，并在 `onMounted` 中动态导入 embed。

## 无构建工具

从安装包的 `dist/widget.js` 复制到站点静态目录，通过 `<script src="/vendor/widget.js"></script>` 加载，再调用 `window.LeverAcc.mountLeverAccWidget(element, options)`。发布新版本时同步更新文件和缓存版本；该脚本无需额外加载 React。不要把 ESM 的 `embed.js` 当普通 script 使用。

## 上线联调与常见问题

- 默认创建流程涉及 Protocol Service 与真实钱包签名，测试前先使用目标测试网的项目、资产和 RPC。模拟测试通过不代表项目授权或真实资金流程已联调。
- 确保宿主允许访问配置的 RPC、Protocol Service、Hyperliquid 与 Circle 服务；自定义服务需允许宿主 Origin 的 CORS。Shadow DOM 隔离样式；严格 CSP 需按实际 style、字体和网络策略验证。
- `accountActionRequired` 表示宿主需处理账户授权等阻塞条件；处理后调用 `refresh()`。`awaitingAction` 需要用户继续钱包操作。
- 将旧 `operationSuccess` 处理迁移到 `operationSubmitted`（`stage: "submitted"`）。它只表示已发出，不表示链上执行或到账成功；`action` 可为 `bridgeApproval` 或 `gasFunding`。旧事件类型已弃用，不再发送。
- React invalid hook call：检查 React 与 ReactDOM 版本一致，避免宿主打包重复 React。React 页面使用根入口。
- 找不到模块：检查版本已发布、scope 拼写、registry 设置及导出路径。首次发布前使用 `npm install /path/to/leveracc-widget-0.1.0.tgz`。
- 创建／借款受阻：检查 projectId、网络、授权、充值资格和真实 HYPE。查看 `error` 和 `accountActionRequired`。开户自动重试状态查询，刷新后恢复待处理充值及开户，并在结果未知时禁止重复提交；其他交易保持原有重试行为。

完整配置和事件说明见 [README](../README.zh-CN.md)。升级前查看发布说明，先在测试环境验证；可用 `npm install @leveracc/widget@<version>` 固定版本，预发布通过 `@next` 安装。
