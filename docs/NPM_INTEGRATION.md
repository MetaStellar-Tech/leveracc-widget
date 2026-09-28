# npm integration

**English** | [简体中文](NPM_INTEGRATION.zh-CN.md)

Try the runnable [standalone npm example](../examples/npm/README.md): run `pnpm example:npm:setup` and `pnpm example:npm` from the repository root, then open http://localhost:5174. It installs an actual package archive to demonstrate React / embed, four themes, and language switching.

This guide is for integrators installing `@leveracc/widget` in their own projects. See the [release process](RELEASING.md) for publishing and maintenance, and [wallet integration](WALLET_INTEGRATION.md) for wallet SDKs and authorization services.

## Installation and entry points

Once the package is published to npm, run the following (before the first release, replace the package name with a maintainer-provided `.tgz`):

```sh
npm install @leveracc/widget react react-dom
# Or pnpm add @leveracc/widget react react-dom
```

React and ReactDOM must use matching versions; 18.3.1 and 19 are supported. Existing React projects can keep versions within the supported range. The package is ESM and targets modern browsers with ES2022, Shadow DOM, and dialog support; there is no CommonJS `require()` entry point. For TypeScript, use `moduleResolution: "Bundler"`. No separate CSS import is required: fonts, icons, and styles are bundled.

| Entry point | Purpose |
| --- | --- |
| `@leveracc/widget` | React component, ref, and public types; reuses the host's React |
| `@leveracc/widget/embed` | Mounting in Vue / plain JavaScript; includes the React runtime |
| `@leveracc/widget/wallets` | viem, wagmi, and Privy wallet adapters |
| `@leveracc/widget/wallets/react` | React wallet adapter hooks |
| `@leveracc/widget/widget.js` | Browser script with bundled dependencies; exposes the `LeverAcc` global |

The package currently declares React peer dependencies even when using embed, so use the same installation command. You do not need wagmi, Privy, or React Query unless you choose a wallet integration that uses those SDKs. Do not import internal files from `dist` or `src`.

Before starting, obtain a **registered projectId** on the target network (bytes32: `0x` followed by 64 hexadecimal digits) and prepare the host's wallet connection UI. Arbitrarily constructed IDs cannot be used for real operations. HyperEVM testnet is chain 998 and mainnet is 999; withdrawals pair these with Arbitrum Sepolia 421614 and Arbitrum One 42161 respectively. The project operator is responsible for project registration, trading authorization, and Risk Wallet configuration; see the wallet guide.

## React

The following component accepts the wallet and connection method already selected by the host and can be added directly to an application page:

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
    locale: "en",
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

`wallet` is an EIP-1193 provider (`request` and account / chain event subscriptions), not a wallet address or signer. The widget does not scan for browser wallets: the host initiates the connection and passes the provider through props, then passes `undefined` on disconnect. For wagmi / Privy, use the [adapter examples](WALLET_INTEGRATION.md); do not pass an SDK client object directly as the provider.

Pass a new, complete `config` object when changing language, theme, or features. Unspecified entries in `features` are enabled by default. After completing on-chain authorization, the host can call `await ref.current?.refresh()`. Cleanup runs automatically when the component unmounts.

### Next.js App Router

Add `"use client"` at the top of the client component file. Access wallets in effects or click handlers, avoiding reads of `window` during rendering. If the host's wallet SDK cannot run during server rendering, disable SSR in a client wrapper:

```tsx
"use client";
import dynamic from "next/dynamic";
export const AccountPanel = dynamic(
  () => import("./AccountPanel").then((m) => m.AccountPanel),
  { ssr: false },
);
```

Use the React example for the `AccountPanel.tsx` referenced above. Providers and callbacks must be created on the client; they cannot be serialized and passed from a Server Component.

## Plain JavaScript

```js
import { mountLeverAccWidget } from "@leveracc/widget/embed";

// The host provides element, projectId, wallet, and connect.
export function mountAccount(element, projectId, wallet, connect) {
  let config = { projectId, network: "testnet", locale: "en" };
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

Insert the container into the DOM before mounting, and mount only once per container. Call `destroy()` when leaving the page; repeated calls are safe. `config` in `update()` replaces the entire configuration without a deep merge; `update({ wallet: undefined })` disconnects the wallet. Unmounting does not cancel on-chain transactions already submitted.

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

In Nuxt, use a client component or `ClientOnly`, and dynamically import embed in `onMounted`.

## Without a build tool

Copy `dist/widget.js` from the installed package into your site's static directory, load it with `<script src="/vendor/widget.js"></script>`, then call `window.LeverAcc.mountLeverAccWidget(element, options)`. Update the file and cache version when releasing a new version. This script does not require loading React separately. Do not load the ESM `embed.js` as a classic script.

## Deployment integration and troubleshooting

- The default account creation flow uses Protocol Service and real wallet signatures. Start with a project, assets, and RPC on the target testnet. Passing mock tests does not verify project authorization or real fund flows.
- Ensure the host allows access to the configured RPC, Protocol Service, Hyperliquid, and Circle services. Custom services must allow the host Origin through CORS. Shadow DOM isolates styles; validate strict CSP against the actual style, font, and network policies.
- `accountActionRequired` means the host must resolve a blocking condition such as account authorization, then call `refresh()`. `awaitingAction` requires the user to continue with the next wallet operation.
- Migrate `operationSuccess` handlers to `operationSubmitted` (`stage: "submitted"`). This means submitted, not executed or received; `action` can be `bridgeApproval` or `gasFunding`. The old event type is deprecated and no longer emitted.
- React invalid hook call: check that React and ReactDOM versions match and avoid bundling duplicate copies of React in the host. Use the root entry point for React pages.
- Module not found: check that the version is published, the scope is spelled correctly, and the registry and export paths are correct. Before the first release, use `npm install /path/to/leveracc-widget-0.1.0.tgz`.
- Creation / borrowing blocked: check projectId, network, authorizations, successful funding eligibility, and live HYPE. Inspect `error` and `accountActionRequired`, and refresh to retry reads. Transactions are not cached or restored, and failures do not retain submission locks; check the wallet before retrying an unknown outcome.

See the [README](../README.md) for the full configuration and event documentation. Review release notes before upgrading and validate in a test environment first. Pin a version with `npm install @leveracc/widget@<version>` or install prereleases through `@next`.
