# Wallet integration and complete flows

**English** | [简体中文](WALLET_INTEGRATION.zh-CN.md)

The widget uses viem for on-chain reads and writes. The host manages login, wallet discovery, connection, selection, disconnection, and its own project authorization service. You can use wagmi injected / WalletConnect connectors or Privy embedded / external wallets. The base widget does not require wagmi or Privy; both are development dependencies for examples in this repository only.

## wagmi

Complete runnable example: `examples/react/main.tsx`, using wagmi 3, TanStack Query, and viem.

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
      {loading && <p>Preparing wallet…</p>}
      <LeverAccWidget
        config={config}
        wallet={wallet}
        onConnect={openYourWalletSelector}
      />
    </>
  );
}
```

`config` is a real WidgetConfig, and `openYourWalletSelector` opens the host's connector selection UI. The host needs `WagmiProvider` and `QueryClientProvider`, with HyperEVM 998 / 999 in its chain configuration and Arbitrum Sepolia 421614 / Arbitrum One 42161 for testnet / mainnet withdrawals respectively. With wagmi 2, use `useAccount()` to obtain equivalent connection fields; the `walletFromWagmi` interface is unchanged.

Do not include `chainId` in the adapter creation dependencies: switching chains for the same account during a multistep flow must preserve wallet identity and in-flight operations. Destroy the old adapter only when changing the connector or owner, or disconnecting. `useWidgetWallet` discards stale asynchronous providers and cleans up subscriptions; memoize the creation function.

The example supports browser wallets by default. WalletConnect requires your own `VITE_WALLETCONNECT_PROJECT_ID`; without it, that connector is not shown. The host manages wagmi's EIP-6963 discovery and reconnection; the widget does not scan `window.ethereum`.

## Privy

Complete runnable example: `examples/privy/main.tsx`.

Copy `.env.example` to `.env.local`, enter your own `VITE_PRIVY_APP_ID`, allow the site's Origin in the Privy console, and start the development server. This ID is not a server secret; never put an app secret in frontend code.

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

`usePrivyWidgetWallet` keeps the adapter stable for the same owner while using the SDK's updated wallet methods, preventing normal chain switches from invalidating in-flight flows. The host must explicitly select the owner; do not automatically use `wallets[0]` in place of the owner of an existing LAAccount. The Privy adapter calls the selected wallet's `switchChain()`, retrieves `getEthereumProvider()` again, and verifies the actual chain and authorized account. Privy's supported chains must include HyperEVM and Arbitrum where required.

During wallet operations, the widget temporarily leaves the native modal top layer so the browser does not make the host's Privy login / signing UI non-interactive. There is no need to disable wallet confirmation UI to interact through the widget modal.

## viem / plain JavaScript

```ts
import { walletFromViem } from "@leveracc/widget/wallets";
const adapter = await walletFromViem(walletClient, originalEip1193Provider);
const widget = mountLeverAccWidget(element, { config, wallet: adapter });
// When changing accounts or destroying the host connection:
widget.destroy();
adapter.destroy();
```

Pass a connected JSON-RPC WalletClient. This browser integration does not support private-key local accounts or RPC-unlocked accounts. Passing the original EIP-1193 provider forwards live account, chain, and disconnect events. With only a WalletClient and no provider, the host must recreate the adapter and update the widget when identity changes; it cannot rely on an event source that does not exist.

## Project authorization and gas services

The following describes the compatible flow when neither new creation switch is supplied. For independent modes, see [Creation Gas conversion and activation](#creation-gas-conversion-and-activation).

Connecting a wallet does not grant project trading authorization. Creating an LAAccount does not automatically authorize a project Execution Wallet or configure a Risk Wallet. The project operator must implement those operations according to its own service contract; wagmi / Privy cannot provide project signatures themselves.

The default Quick Borrow dialog does not display account setup instructions or an account setup button. The host application must provide its own account setup flow. `onAccountSetup` and the controller’s `setupAccount()` remain available for compatibility, but the default dialog does not invoke them. Borrowing remains blocked until the on-chain prerequisites are met.

The widget includes a default 3 USDC top-up flow. Optional callbacks let the host override top-ups or integrate project authorization:

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

`yourProjectOnboarding` and `yourGasFundingFlow` in the callbacks are the integrator's own implementations, not services provided by this package. The widget does not handle login tokens or accept project private keys. By default, account creation queries the current owner's records through `GET /api/v1/gas-top-ups?user_eoa=…`. It requires a single record with `requested_usdc_amount_raw="3000000"`, `phase="success"`, and `terminal=true`, plus an on-chain balance of at least 0.01 HYPE. Both conditions are checked again after the callback returns; callback success alone is not proof of funding. Borrowing remains blocked until authorization takes effect.

Depending on the network, the service defaults to `https://protocol-service.leveracc.xyz` or `https://protocol-service-testnet.leveracc.xyz`; override it with `config.protocolServiceUrl`. Allow cross-origin reads from the host page. Historical eligibility comes from service records without age or source-chain restrictions or summing multiple payments. The modal automatically retries unmet readiness checks every 5 seconds without overlapping requests; no “Refresh status” button is required. Recheck conditions before funding or creation.

Projects can set this option in `config` for React or embedded integrations (default `false`, boolean only):

```ts
const config = {
  projectId,
  network: "mainnet",
  locale: "en",
  skipCreationTopUpCheck: true,
} as const;
```

When enabled and no built-in payment is pending, the widget does not request payment history. It checks the live HYPE balance of the Fund wallet (owner EOA) on the current network’s HyperEVM. At least 0.01 HYPE satisfies the creation funding requirement even when the history service is unavailable; insufficient gas or failed RPC reads still block creation. Creation rechecks the balance before submission, and configuration or wallet changes invalidate old requests. Built-in 3 USDC funding and `onGasTopUp` remain available for insufficient gas; built-in funding still requires service route configuration. Sufficient gas skips funding and the callback. This option does not mark the account as activated: the project handles subsequent activation checks. Existing signature, ownership, project binding, and subsequent operation checks remain unchanged.

When `onGasTopUp` is not configured:

- On mainnet, read the Arbitrum route from `/api/v1/gas-top-ups/config` and validate chain ID 42161, the native USDC address, recipient, and amount limits. Switch the main wallet to Arbitrum, check the 3 USDC and ETH balances, then simulate and submit a USDC `transfer`.
- On testnet, send 3 USDC to the configured `system_core_account_address`. Both source and destination are HyperCore Spot, using the existing owner signing and chain-switch validation.
- A returned hash or successful Core submission emits `operationSubmitted` (`action: "gasFunding"`). Persist the pending payment and automatically verify the source transfer, matching service record, delivery receipt and HYPE balance. Resume on reopening or reload. Use the service polling interval, defaulting to 5 seconds.
- Explicit rejection permits retry. Unknown outcomes and pending transfers block duplicate payments; transient query errors retry automatically. Terminal service failures keep the payment blocked and display the reason. Explicit source transaction reverts clear the pending record.
- Browser storage must work before broadcast so pending transfers can be restored. Local records never establish eligibility; direct HYPE replaces the historical 3 USDC record requirement only with `skipCreationTopUpCheck`. Already pending built-in payments still query service records for tracking.

When `onGasTopUp` is configured, the host flow is used, followed by the same service and gas checks. The host flow must generate compatible top-up records unless `skipCreationTopUpCheck` is enabled; in that mode only the gas balance is checked.

### Creation Gas conversion and activation

Configure `creationGasConversionEnabled` and `creationAccountActivationEnabled` independently. Both accept only booleans and default to `true`.

| Gas conversion | Account activation | Preparation |
| --- | --- | --- |
| `true` | `true` | One combined 3 USDC transfer |
| `true` | `false` | Independent 3 USDC Gas conversion |
| `false` | `true` | Independent 1.1 USDC activation payment |
| `false` | `false` | Proceed directly to account creation |

For activation only:

```ts
const config = {
  projectId,
  network: "mainnet",
  locale: "en",
  creationGasConversionEnabled: false,
  creationAccountActivationEnabled: true,
} as const;
```

When Gas conversion is disabled, neither the creation readiness check nor account submission enforces the fixed 0.01 HYPE minimum. Actual transaction simulation and wallet transaction checks still apply. Disabled functions do not require their eligibility queries. Both switches off permits creation without a payment service; previously submitted payments remain stored and are reconciled separately without blocking eligibility for disabled functions.

Omitting both new switches preserves the complete legacy behavior, including `skipCreationTopUpCheck: true` checking only HYPE. Once either switch is explicitly supplied, the other defaults to `true` and `skipCreationTopUpCheck` skips only Gas payment history; it never skips enabled activation preparation. Gas-only mode reads `/api/v1/gas-conversions`, activation-only mode reads `/api/v1/account-activations`, and combined mode continues to use `/api/v1/gas-top-ups`. Explicit combined mode checks activation allocation in successful service records. Gas-only records cannot establish combined activation eligibility.

The modal keeps the existing preparation and creation steps, button placement, and automatic polling. Copy and amounts follow the selected mode, and both-off mode hides the preparation step and shows only account creation. There is no end-user mode selector. Mainnet uses Arbitrum USDC; testnet uses HyperCore Spot.

Independent modes require an additional wallet message signature: fetch route configuration and `/orders/challenge`, validate the payer, flow, source, receiver, amount, nonce, expiry and signing message, sign it, then POST `/orders` before transferring. The endpoint prefix is `/api/v1/gas-conversions` or `/api/v1/account-activations`. Allow cross-origin GET and JSON POST requests to the service. Combined mode retains the existing direct transfer without an order signature.

A created order is not payment confirmation. The widget queries `/orders/{intent_id}` and its `matched_top_up_id` or `matched_activation_id`. Activation statuses `waiting_account`, `submitting`, and `activated` satisfy creation preparation; `waiting_account` means payment is confirmed and fulfillment awaits account creation. The service can also confirm `already_activated`. An unpaid order or general `activation_pending` status alone does not unlock creation. Activation-only never waits for HYPE delivery or final activation before creating the account. Gas conversion requires at least 0.01 HYPE and successful conversion evidence; only the evidence requirement can be skipped with the history opt-out.

Pending payment records retain flow, amount, order ID, associated record ID and transfer identity; old records restore as combined payments. An unexpired order can be recovered from the service after reopening or rejecting a transfer. Expiring orders must expire before replacement; never send against an expired order. Unknown transfer outcomes remain locked until reconciled, even if the order expires. Wallet, network, service or switch changes invalidate stale readiness checks. Cross-tab locks prevent concurrent payment submissions. Creation submission rechecks the same requirements as the modal.

`topUpGas()` and `onGasTopUp` remain available. The callback receives optional `flow` (`combined`, `gas_only`, `activation_only`, or `none`) and `amountRaw` fields describing the selected preparation. It overrides funding for the selected mode and must produce matching service evidence. Both-off mode skips the callback. Callback resolution alone never establishes payment eligibility.

## Verification coverage

Local tests cover SDK adapters, owner validation, SDK chain switching, adding unknown chains, disconnect / asynchronous cleanup, host wallet modal interaction, and fund flows. Real Privy login, WalletConnect sessions, and on-chain fund operations require your own app / project configuration and wallet. Passing builds or mock tests does not establish successful production integration.

Official interfaces: [viem Wallet Client](https://viem.sh/docs/clients/wallet), [wagmi useConnect](https://wagmi.sh/react/api/hooks/useConnect), and [Privy wallet connection](https://docs.privy.io/wallets/connectors/usage/connect-or-create). The example SDK versions match the adjacent dapp.
