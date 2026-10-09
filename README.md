# LeverAcc Widget

**English** | [简体中文](README.zh-CN.md)

[npm integration](docs/NPM_INTEGRATION.md) · [Wallet integration](docs/WALLET_INTEGRATION.md) · [Release process](docs/RELEASING.md) · [Standalone npm example](examples/npm/README.md)

A standalone React / JavaScript account and lending widget that uses an integrator-provided EIP-1193 wallet. **No v1 API, login session, cookies, or backend account registration is required.** The Factory and on-chain state are the source of truth for accounts. Core balances are queried through the protocol read adapter, and the initial deposit relay is signed through the Hyperliquid SDK.

When no account exists, the widget shows account creation onboarding. After on-chain verification succeeds, it shows an account overview and configurable deposit, borrow, repay, transfer, and withdraw buttons. All flows run in modals inside Shadow DOM, with English / Chinese, light / dark themes, mobile layouts, and keyboard support.

## npm installation and publishing

Build locally and publish to the official npm registry:

```sh
npm login --registry=https://registry.npmjs.org/
pnpm publish:npm:dry-run  # Build, test, and verify packaging; simulate publishing without uploading
pnpm publish:npm          # Upload the verified .tgz to npm after all checks pass
```

You can also use `npm run publish:npm`. The command uses the current version, with `latest` for stable releases and `next` for prereleases; it does not bump the version or create Git tags. Publishing requires permissions for `@leveracc`, and the same version cannot be published twice.

Specify an npm tag directly to override the defaults of `latest` for stable releases and `next` for prereleases:

```sh
pnpm publish:npm --tag beta
pnpm publish:npm --tag latest
pnpm publish:npm:dry-run --tag alpha
npm run publish:npm -- --tag beta
```

`--tag=beta` is also supported and can be combined with `--dry-run`. Missing or empty tags, duplicate options, and unknown arguments fail before release checks. npm validates tag eligibility. GitHub automatic publishing still selects the tag from the version.

Local packaging and the standalone npm integration example:

```sh
pnpm publish:local       # Build and generate artifacts/*.tgz without uploading to a registry
pnpm example:npm:setup   # Repack and install into examples/npm with npm
pnpm example:npm         # http://localhost:5174
```

The example provides React / embed switching, four theme previews, language selection, and host wallet connection, importing only from the installed npm package. See the [standalone npm example](examples/npm/README.md) for details. `pack:local` is equivalent to `publish:local`; publishing from a local machine to the npm registry still follows the [release process](docs/RELEASING.md).


```sh
npm install @leveracc/widget react react-dom
```

Before the first release, install a maintainer-provided `.tgz`. Third-party projects should start with the [npm integration guide](docs/NPM_INTEGRATION.md) (React, Next.js, Vue, and JavaScript); maintainers should see the [release process](docs/RELEASING.md).

## Wallet integration and complete flows

Adapters and real SDK examples are provided for viem, wagmi, and Privy; see the [wallet integration guide](docs/WALLET_INTEGRATION.md). The React example uses wagmi connectors, and the Privy example is in `/examples/privy/`. `onConnect` opens the host's wallet connection UI. Optional `onAccountSetup` and `onGasTopUp` callbacks integrate project authorization and gas services, followed by on-chain state verification. The default Quick Borrow dialog does not display account setup instructions or an account setup button; the host application must provide its own setup flow. `onAccountSetup` and the controller’s `setupAccount()` remain available for compatibility. Borrowing still requires the on-chain prerequisites to be met. The base widget does not require the host to install wagmi / Privy.

## Integration

```tsx
import { LeverAccWidget, type WidgetConfig } from "@leveracc/widget";

const config: WidgetConfig = {
  projectId: "0x…", // Registered project bytes32: 0x followed by 64 hexadecimal digits
  network: "testnet",
  locale: "en",
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

React / ReactDOM are peer dependencies; React 18.3 and 19 are supported. The host does not need Wagmi, Privy, or a React Query provider. Update props to change configuration; the React ref exposes `refresh(): Promise<void>`.

Plain JavaScript / Vue projects use the entry point with bundled React:

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
widget.destroy(); // Safe to call repeatedly
```

Without a build tool, host `dist/widget.js` and use the global `LeverAcc.mountLeverAccWidget`. Configuration updates replace the entire configuration rather than deep-merging it. Wallets should implement `request` and subscription / unsubscription for `accountsChanged` / `chainChanged`; without event interfaces, the host should update the provider when identity changes.

## Configuration

| Field | Default / constraint | Description |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `projectId` | Required bytes32 | Registered project ID |
| `network` | Required `mainnet` / `testnet` | HyperEVM 999 / 998, paired with the corresponding Core network |
| `protocolServiceUrl` | Network preset | Protocol Service URL for querying top-up history before account creation |
| `skipCreationTopUpCheck` | `false` | Skip the creation 3 USDC payment history check; still requires at least 0.01 HYPE in the Fund wallet; boolean only |
| `rpcUrl` | Network preset | HyperEVM RPC for the same network |
| `arbitrumRpcUrl` | Network-matched Arbitrum preset | Arbitrum One (42161) on mainnet; Arbitrum Sepolia (421614) on testnet |
| `locale`                      | `en`                       | `en` / `zh`                                                              |
| `theme`                       | `dark`                     | `light` / `dark`                                                         |
| `primaryColor` | `#0099ff` | Six-digit HEX primary color for compatibility with older integrations; overridden by `colors.primary` |
| `colors` | Theme preset | `Partial<WidgetColors>` semantic colors for the main panel and all modals |
| `features` | All six enabled | `tradingAccount`, `deposit`, `borrow`, `repay`, `transfer`, `withdraw`; all may be disabled |
| `borrow.termSeconds` | `604800` | Protocol borrowing term, positive uint32 |
| `borrow.maxCoreReturnFeeUsdc` | `"1"` | Maximum fee for returning funds from Core |
| `borrow.expiryWindowSeconds` | `900` | Intent validity period, 1–3600 seconds |
| `arbitrumWithdrawalEnabled` | `true` | Both networks; confirm the deployment supports Circle forwarding |

With `config.skipCreationTopUpCheck: true`, creation checks only that the Fund wallet (owner EOA) has at least 0.01 HYPE on the current network’s HyperEVM, without requesting payment history when no built-in payment is pending. History service failures do not block creation, but insufficient balances or balance read failures do. Built-in 3 USDC funding and `onGasTopUp` remain available when gas is insufficient; built-in funding requires available route configuration. Sufficient gas skips funding and the callback. Configuration changes invalidate old checks. Creation does not imply activation: the project handles subsequent activation checks. Existing signature, ownership, project binding, and subsequent operation checks remain in place. See the [wallet integration example](docs/WALLET_INTEGRATION.md).

The legacy `apiBaseUrl`, `indexerUrl`, and `defaultTab` options have been removed; `protocolServiceUrl` queries top-up records before account creation. The entry area does not automatically open operation modals. Disabling a feature closes its modal and prevents new signatures and submissions through the controller; already submitted transactions continue to be tracked.

### Network deployments for third-party integrations

`network` selects the protocol contracts below for each widget instance. These addresses are built into the package; `WidgetConfig` does not expose contract address overrides. Updating a protocol deployment requires updating the package. Custom RPC URLs change the transport endpoint only and must serve the selected network. External Arbitrum deposits reject an RPC with a mismatched chain ID before reading balances or requesting signatures.

| Configuration | `mainnet` | `testnet` |
| --- | --- | --- |
| HyperEVM chain ID | `999` | `998` |
| Arbitrum chain ID | `42161` | `421614` |
| AccountFactory | `0x7211c8159449b99f0b7cdb6b7a9ea01b2e5c1ce7` | `0xe672fc21d0e429076b4386d20b5951eba214aedb` |
| FundVaultManager | `0x03524982bba6763d045d1a44f3c090ffcf39774b` | `0x99d8f178af00b229cbc00676f42f0a492bdef52c` |
| CoreDepositWallet | `0x6b9e773128f453f5c2c60935ee2de2cbc5390a24` | `0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206` |
| Protocol Service | `https://protocol-service.leveracc.xyz` | `https://protocol-service-testnet.leveracc.xyz` |

Supply your own registered `projectId` for the selected network. Do not copy the LeverAcc dapp's self-strategy project ID. The widget passes the host project ID into account creation, project binding, and borrowing; registration and execution/risk wallet authorization remain the project operator's responsibility. An existing account can require project binding before borrowing. Switching networks does not register or migrate a project.

The account's Registry and the manager's USDC asset are read on chain. FundVault generation addresses are not pinned. Mainnet and testnet instances can coexist; when switching an instance, pass the complete configuration with the target network's project ID and any custom RPC/service URLs. Omitting those URLs selects the new network's defaults. Testnet gas funding uses HyperCore; mainnet gas funding uses Arbitrum One. Testnet external Fund deposits and withdrawals use Arbitrum Sepolia, while CCTP forwarding directly to HyperCore is unavailable on testnet.

## Accounts and fund flows

- Fund is the host wallet's owner EOA; Trade is the LAAccount returned by Factory `primaryAccountOf(owner)`. Read failures show an error and are not treated as an absent account.
- By default, creation requires a successful historical 3 USDC Protocol Service top-up and at least 0.01 HYPE. The modal automatically checks unmet conditions every 5 seconds, then offers “Sign & Create Account”. Before signing, it checks conditions again. After submission it checks the receipt every 3 seconds, verifies the Factory mapping and account owner, factory, project and binding epoch, then shows completion. There is no manual refresh button. Mainnet funding transfers Arbitrum native USDC; testnet funding uses HyperCore Spot. The receiver comes from Protocol Service configuration. `onGasTopUp` overrides built-in funding and is followed by automatic checks.
- The three-column overview shows the account address with copying, net equity (collateral) / available trading balance / debt, and the debt ratio (risk index). Collateral uses HyperEVM USDC + HyperCore own funds (see below); available trading balance is Spot USDC `total - hold`, floored at zero, with no fallback to Perps when zero. The risk index is debt / `accountNetValueNow`, not the liquidation threshold. Failed metric reads display `—`.
- **Withdraw**: controlled by the independent `withdraw` feature flag, with Fund or Trade as the source and the owner's Arbitrum wallet as the destination. Mainnet pairs HyperEVM 999 with Arbitrum One 42161; testnet pairs HyperEVM 998 with Arbitrum Sepolia 421614. RPC defaults, native USDC, Circle contracts, fee API and intent chain IDs follow `network`. Trade MAX is `max(0, min(safeUserClaimable, EVM + max(Core Spot - 0.005 USDC, 0) - payableInterestNow))`. Core Spot uses the Hyperliquid spot API and subtracts held USDC after truncating total and hold separately to six decimals. EVM replenishment reserves interest as well as the withdrawal amount. `arbitrumWithdrawalEnabled` defaults to true; unsupported deployments can explicitly set it to `false`, with an explanation shown in the UI. The preview must still allow the full amount to be transferred out. Fund uses Circle approval and bridging directly. Each transaction ends at submission; historical transactions are not restored. Opening/reopening the modal or submitting a transaction reads fresh source balances / limits and the owner's destination USDC balance. Trade is labeled “Withdrawable”; Fund shows the wallet balance. Failed reads remain unavailable, not zero; reopen the modal to retry. Fee parameters are cached per network and direction for the widget lifetime; editing the amount calculates fees locally without refreshing balances or disabling the input. Submission rechecks current fees, and increased fees require confirmation again. Submission status does not occupy withdrawal modal space; errors appear in a floating toast. Updated fees and proceeds appear in the original fields, and the main button confirms the next attempt; no separate review block is shown. Cancelling a wallet prompt retains the current step, including after closing and reopening the modal, without repeating submitted steps.
- After creation, TradeAccount is displayed in a static trading account card showing the address, collateral, borrowed amount, available trading funds, and risk metrics. `features.tradingAccount` controls the address copy button. Collateral info supports hover, keyboard, and touch access to the HyperEVM / HyperCore breakdown. The widget does not place orders or create, refresh, or configure Execution/Risk API Wallets.
- Switching projects requires explicit confirmation. Debt, borrowing batches, unsettled gas debt, or lifecycle actions block switching.
- **Account Transfer: Fund → Trade** follows the dapp: authorize the Core Deposit Wallet if needed, then use `depositFor` to deposit into Trade Core Spot. Initial Core activation relays through the owner's Core account, which must already be activated and retain at least 1.005 USDC. The transfer amount must exceed 1 USDC, and the minimum received amount deducts the 1 USDC activation fee.
- **Account Transfer: Trade → Fund** uses Trade EVM funds first, returning any shortfall from Core Spot to EVM before signing a withdrawal to the owner's HyperEVM wallet. Available Core funds exclude 0.005 USDC of dust. Each subsequent step requiring the wallet displays “Continue transfer”.
- Account details and their “other account transfer” and full repayment shortcuts have been removed; protocol-level transfer and repayment APIs remain available.
- Deposits support owner HyperCore Spot → owner HyperEVM Fund and Arbitrum → owner HyperEVM Fund (mainnet: Arbitrum One 42161 → HyperEVM 999; testnet: Arbitrum Sepolia 421614 → HyperEVM Testnet 998). On testnet, select External Deposit in the Deposit modal and use native test USDC plus ETH for gas on Arbitrum Sepolia. Fee queries use Circle sandbox; approval and bridge contracts match the testnet. The original Fund → Trade EVM controller method remains available; the main UI funds Trade through Account Transfer.
- Borrowing uses on-chain limits, risk parameters, nonce, and fee version. After an amount is entered, the same form shows the interest rate, term, and fee cap; fee changes require confirmation again. Borrowed USDC arrives in Trade EVM.
- Repayment uses the Trade EVM balance. Full repayment includes a 0.1% interest allowance buffer, while the actual charge is capped by live debt. Insufficient funds prompt a transfer first.
- All transactions emit `operationSubmitted` when a hash is returned or Core acknowledges submission. Submission does not prove execution. Creation and its gas funding additionally track confirmation and arrival; other transaction flows still end at submission.

## Events and recovery

Account skeletons appear only for the initial read in a wallet/project/network context. Background refreshes retain the current content until new data arrives; changing context clears the previous account data.

Transaction failures, local operation errors, account read errors, account creation errors, withdrawal requote errors, and minimum borrowing validation use dismissible floating alerts that expire after five seconds without occupying layout space. An initial account read failure disables transaction entry; background failures retain the last account data, and submissions still recheck live conditions.

Modals omit transaction status blocks and explorer links, retaining button progress and required multi-step instructions. After the final transaction is submitted, the form clears the amount, full-repayment selection, and transient input feedback while retaining the selected route. Approval and intermediate steps, wallet cancellations, and failures retain inputs for continuation or retry. Failures show floating alerts and allow retry; `onEvent` provides `operationProgress`, `operationSubmitted`, and `error` for host feedback.

Events include project, network, known owner / account, and operation `operationId`, `action`, `stage`, and known hashes. `operationSubmitted` has stage `submitted` and fires once per submission; `action: "gasFunding"` identifies built-in gas funding. `awaitingAction` offers a manual continuation or retry, not proof of arrival. Legacy `operationSuccess`, `success`, `confirming`, `bridging`, and `settling` types remain deprecated and are no longer emitted; migrate submission feedback to `operationSubmitted`.

Missing on-chain trading authorization, Risk Wallet, project binding, or Core activation produces a specific blocking reason and an `accountActionRequired` event. The host can resolve it and call `refresh()`; the widget does not call the host's business APIs.

Account creation and built-in gas funding persist pending transaction identifiers in localStorage, isolated by network, service and owner (also project for creation), and resume verification after reopening or reload. Account creation is recorded only after the wallet returns a transaction hash; waiting for a signature or a hash does not create a persistent pending record. Legacy creation records without a hash are discarded when read so they cannot block retry after reload. Built-in funding still requires working storage before broadcast. Pending funding verifies source transfer logs, matching service status, HYPE delivery receipt and balance; local records are never proof of payment. Legacy transaction cleanup preserves these new records. Other transactions remain in memory only. Instance locks and Web Locks protect concurrent submissions.

Creation confirmation queries track returned transaction hashes. If creation fails without returning a hash, explicit retry is allowed after checking the wallet; a missing hash does not prove that no transaction was broadcast. Each creation attempt rechecks the factory account mapping before signing. Unknown gas-funding submissions remain blocked against duplicate sends while automatic checks continue. Temporary RPC or service failures are retried without resubmission; terminal service failures display their reason and keep the payment blocked. Explicit wallet rejection permits retry; an explicitly reverted transaction clears its pending record. `creationPending` and `creationFundingPending` in snapshots expose pending creation and funding. The controller’s `creationReadiness()` also returns `creating` and funding `state`, `error` and `pollAfter` (milliseconds). Other transaction retry behavior is unchanged.

## Development and verification

```sh
pnpm install
pnpm build
pnpm dev
pnpm test
pnpm build:examples
pnpm test:browser
```

Example pages import from `dist`, so rebuild after source changes. Before the first browser test run, install Chromium with `pnpm exec playwright install chromium`. Automated verification uses mocked wallets, RPC, Core, and Circle services and does not submit real fund transactions.

`pnpm abi:sync` syncs protocol ABIs, including the Core Deposit Wallet interface, from the adjacent `leveracc-hyperevm-protocol` ABI / out artifacts. Package installation and builds do not depend on adjacent repositories. Network addresses and interactions follow `../leveracc-dapp`; the dapp, server, and contracts have not been modified. Pushing a matching `v*` version tag triggers npm publishing; see the [release process](docs/RELEASING.md). It does not automatically deploy a website.

### UI and reference project

Default modals follow the adjacent dapp's visual conventions and operation steps: account creation is 440px wide, quick borrowing 448px, and fund operations 512px. `theme` / `primaryColor` configuration and Shadow DOM isolation remain supported. The main panel adapts to its container up to 720px: metrics and actions wrap below 360px, while metrics and the risk area sit side by side from 640px. The account creation entry keeps its original layout. Modals are centered in the viewport, reduce padding and wrap fund card content on narrow screens, and scroll internally on short screens. Fonts and icons are bundled; licenses are in `docs/licenses/`.

- Deposit: Arbitrum → owner Fund (HyperEVM), or owner HyperCore Spot → owner Fund; the Core route retains 0.005 USDC.
- Withdraw: Fund or Trade is the source, and the owner's Arbitrum wallet is the destination. Fund approves Circle before bridging. Trade is enabled by default and can be disabled with `arbitrumWithdrawalEnabled: false`; if necessary, it first replenishes Trade EVM from Core Spot, then explicitly continues bridging. Submission is blocked when contract limits prevent transferring the full amount.
- Fund ↔ Trade remains in the transfer entry, and historical internal withdrawal records are not restored. Existing underlying methods have not been removed; `TransferRoute` adds `fundToArbitrum`.
- Quotes appear in the form and fee increases require another confirmation. Approval emits `operationSubmitted` with `action: "bridgeApproval"`; this proves neither effective allowance nor withdrawal arrival.
- Built-in funding requires 3 USDC on the source network and Arbitrum ETH for mainnet gas. Pending transfers are restored and cannot be sent again. Funding status uses the service polling interval, defaulting to 5 seconds. Direct HYPE does not replace historical funding eligibility unless `skipCreationTopUpCheck` is enabled. A pending built-in payment is still tracked through service records even with this option enabled.

Visual comparisons use real components from the reference repository with fixed test data, without starting its backend or modifying that repository:

```sh
node scripts/build-ui-reference.mjs
LEVERACC_REFERENCE=1 pnpm exec playwright test reference-comparison.spec.ts
```

This requires the adjacent `leveracc-dapp` with dependencies installed; normal installation, builds, and `pnpm check` do not depend on it. Comparison outputs are written to `test-results/reference-*.png` and `test-results/widget-*.png`. Account-level repayment uses on-chain principal, interest, and total debt; when historical borrowing records are unavailable, the original amount displays `--`. The account card is static except for address copying; the account details modal and its full repayment shortcut are no longer available. Total collateral uses HyperEVM USDC + HyperCore own funds, with the info overlay showing both layers. For HyperCore, a nonzero total Spot USDC balance takes precedence; otherwise, Perps account value is used, minus live debt and floored at zero. Reads show skeleton loaders and an unavailable state on failure. The UI no longer provides a Refresh status button; the host refresh() API and automatic refresh remain available. Entering a borrowing amount reveals the interest rate, term, and fee cap involved in the signature.

### Language configuration and dynamic updates

The widget supports `locale: "en" | "zh"` and defaults to English when omitted. The integrator controls the language; there is no language selector inside the widget. Updating only the language preserves open modals, entered amounts, and operation progress.

In React, update props using a new configuration object:

```tsx
const [config, setConfig] = useState<WidgetConfig>({
  projectId,
  network: "testnet",
  locale: "en",
});
// When the host application switches language:
setConfig(current => ({ ...current, locale: "zh" }));
// Render: <LeverAccWidget config={config} wallet={wallet} />
```

In plain JavaScript, update the instance with the complete configuration, preserving the existing network and project settings:

```js
let config = { projectId, network: "testnet", locale: "en" };
const widget = mountLeverAccWidget(element, { config, wallet });
config = { ...config, locale: "zh" };
widget.update({ config });
```

Both React and vanilla JS example pages provide host-side language selection. The account transfer UI offers only bidirectional transfers between Fund and Trade; controller interfaces for transfers between layers remain compatible.


### Platform theme colors


#### Common theme presets

Both the root entry point and `@leveracc/widget/embed` export `widgetThemes`, `WidgetTheme`, and `WidgetThemeName`. Presets include complete `theme` and `colors` values that can be spread directly into configuration:

| Preset | Mode | Style |
| --- | --- | --- |
| `widgetThemes.light` | Light | White panels and blue primary buttons, preserving the default light appearance |
| `widgetThemes.dark` | Dark | Dark gray panels and blue primary buttons, preserving the default dark appearance |
| `widgetThemes.midnight` | Dark | Deep navy backgrounds, light blue buttons, and dark button text |
| `widgetThemes.lavender` | Light | Pale purple backgrounds and purple primary buttons |

```ts
import { widgetThemes, type WidgetConfig } from "@leveracc/widget";

const config: WidgetConfig = {
  projectId,
  network: "testnet",
  ...widgetThemes.dark,
};

// Light mode:
const lightConfig = { ...config, ...widgetThemes.light };

// Override the primary color on top of a preset:
const customConfig = {
  ...config,
  ...widgetThemes.midnight,
  colors: { ...widgetThemes.midnight.colors, primary: "#a78bfa" },
};
```

Switching at runtime in React:

```tsx
// name has type WidgetThemeName: light | dark | midnight | lavender
setConfig(current => ({ ...current, ...widgetThemes[name] }));
```

Switching at runtime with embed:

```js
import { widgetThemes } from "@leveracc/widget/embed";

config = { ...config, ...widgetThemes.light };
widget.update({ config });
// The global script also exposes LeverAcc.widgetThemes.light.
```

Spread both `theme` and `colors` from the preset when switching to replace the previous palette while preserving project, network, and other settings. Presets are read-only objects; create custom palettes with object spreads. Since presets include `colors.primary`, override that field instead of `primaryColor`. If you only need the default light / dark appearance, set `theme: "light"` or `theme: "dark"` directly and remove previous `colors` overrides.

The React, vanilla, and Privy example pages (with an App ID configured for Privy) provide a theme selector above the widget preview to switch instantly between these four presets.


Both React and embed entry points export `WidgetColors`. Partially override the default palette through `config.colors`. Every value must be a six-digit HEX color (`#RRGGBB`, case-insensitive); CSS variables, color names, and HEX colors with alpha are unsupported. Invalid values throw `INVALID_CONFIG`, with the relevant field in the error message. The widget derives transparent backgrounds, hover states, and overlay / shadow opacity.

| Field | Purpose | light default | dark default |
| --- | --- | --- | --- |
| primary | Primary buttons, links, emphasis, and focus | #0099ff | #0099ff |
| surface | Main panel, cards, and standard modal backgrounds | #ffffff | #171a20 |
| background | Borrow / repay modals and secondary backgrounds | #f5f7fa | #080b0d |
| subtle | Subtle backgrounds, selected states, and derived card backgrounds | #edf1f5 | #22272f |
| border | Borders and skeleton loaders | #dfe7ef | #232a34 |
| text | Primary text | #192c43 | #f7f7f8 |
| textMuted | Secondary text | #63758a | #788697 |
| success | Success states | #22c55e | #22c55e |
| danger | Errors, risk, and debt indicators | #c93636 | #f65959 |
| warning | Account creation top-up buttons and step hints | #ffd700 | #ffd700 |
| info | Account creation top-up information | #0099ff | #0099ff |
| debt | Repayment amount emphasis | #ff4d6d | #ff4d6d |
| onPrimary | Primary button and step text | #ffffff | #ffffff |
| onSuccess | Success button and completed step text | #ffffff | #ffffff |
| onWarning | Account creation top-up button text | #000000 | #000000 |
| badgeText | Account, recommendation, and initial step badge text | #080b0d | #080b0d |
| sliderTrack | Unfilled borrowing slider track | #334155 | #334155 |
| overlay | Modal overlay (50% alpha blend) | #000000 | #000000 |
| shadow | Modal, dropdown, and tooltip shadows | #000000 | #000000 |

Primary color precedence is `colors.primary → primaryColor → #0099ff`. Omitted fields use the selected `theme` defaults; the default theme remains `dark`. Token and chain brand icons retain their original colors.

React example (call `applyPlatformTheme` from the platform's theme-switch callback):

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
    <button onClick={() => applyPlatformTheme("light")}>Platform light</button>
    <button onClick={() => applyPlatformTheme("dark")}>Default dark</button>
    <LeverAccWidget config={config} />
  </>;
}
```

Embed example (`config` is the existing complete configuration):

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

Pass the complete `config` when updating. New `colors` replace previous overrides without deep-merging across updates. Removing a field restores its theme default; removing `colors.primary` still falls back to `primaryColor` if supplied. In React, pass a new configuration object. Changing only colors does not close the current modal, clear inputs, or trigger new account reads; widget instances remain isolated. The platform selects light / dark mode and contrasting text colors; the widget does not automatically detect the system theme. The runnable React and vanilla examples both offer theme switching.
