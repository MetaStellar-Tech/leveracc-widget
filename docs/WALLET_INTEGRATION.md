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

`yourProjectOnboarding` and `yourGasFundingFlow` in the callbacks are the integrator's own implementations, not services provided by this package. The widget does not handle login tokens or accept project private keys. Account creation queries the current owner's records through `GET /api/v1/gas-top-ups?user_eoa=…`. It requires a single record with `requested_usdc_amount_raw="3000000"`, `phase="success"`, and `terminal=true`, plus an on-chain balance of at least 0.01 HYPE. Both conditions are checked again after the callback returns; callback success alone is not proof of funding. Borrowing remains blocked until authorization takes effect.

Depending on the network, the default service is `https://protocol-service.leveracc.xyz` or `https://protocol-service-testnet.leveracc.xyz`; override it with `config.protocolServiceUrl`. The service must allow cross-origin reads from the host page. History detection does not depend on localStorage, restrict record age or source chain, or sum multiple payments. Failed queries block top-ups and account creation and can be retried with “Refresh status” without overlapping requests. The conditions are checked again before starting a top-up or submitting account creation.

When `onGasTopUp` is not configured:

- On mainnet, read the Arbitrum route from `/api/v1/gas-top-ups/config` and validate chain ID 42161, the native USDC address, recipient, and amount limits. Switch the main wallet to Arbitrum, check the 3 USDC and ETH balances, then simulate and submit a USDC `transfer`.
- On testnet, send 3 USDC to the configured `system_core_account_address`. Both source and destination are HyperCore Spot, using the existing owner signing and chain-switch validation.
- A returned hash or successful Core submission emits `operationSubmitted` (`action: "gasFunding"`) and immediately releases the submission lock. There is no transaction cache, receipt / HYPE arrival wait, or restoration of old transactions.
- Rejection, request failure, and unknown outcomes release the submission lock for manual retry without automatic resubmission. Historical pending or failed service records do not lock subsequent actions; account creation still requires successful funding eligibility and enough HYPE.
- Payments work without browser storage. Successful funding eligibility still comes from service records; direct HYPE transfers do not replace a successful 3 USDC record.

When `onGasTopUp` is configured, the host flow is used, followed by the same service and gas checks. The host flow must generate compatible top-up records.

## Verification coverage

Local tests cover SDK adapters, owner validation, SDK chain switching, adding unknown chains, disconnect / asynchronous cleanup, host wallet modal interaction, and fund flows. Real Privy login, WalletConnect sessions, and on-chain fund operations require your own app / project configuration and wallet. Passing builds or mock tests does not establish successful production integration.

Official interfaces: [viem Wallet Client](https://viem.sh/docs/clients/wallet), [wagmi useConnect](https://wagmi.sh/react/api/hooks/useConnect), and [Privy wallet connection](https://docs.privy.io/wallets/connectors/usage/connect-or-create). The example SDK versions match the adjacent dapp.
