import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PrivyProvider,
  usePrivy,
  useWallets,
  useConnectWallet,
} from "@privy-io/react-auth";
import { hyperliquid, hyperliquidEvmTestnet, arbitrum } from "viem/chains";
import {
  LeverAccWidget,
  widgetThemes,
  type WidgetThemeName,
  type WidgetConfig,
} from "../../dist/index.js";
import { usePrivyWidgetWallet } from "../../dist/wallets-react.js";
import "../shared.css";
import { ThemeSelector } from "../ThemeSelector";
const config: WidgetConfig = {
  projectId:
    "0xb5aa45fa7dc556ccc2af82c0a6bb44407b32634c9b384862a27ccae5486fef91",
  network: "testnet",
};
function App() {
  const [themeName, setThemeName] = useState<WidgetThemeName>("dark");
  const { ready, authenticated, login, logout } = usePrivy(),
    { wallets, ready: walletsReady } = useWallets(),
    { connectWallet } = useConnectWallet();
  const [selected, setSelected] = useState(""),
    [event, setEvent] = useState("No events yet.");
  const chosen =
    authenticated && walletsReady
      ? wallets.find(
          (wallet) => wallet.address.toLowerCase() === selected.toLowerCase(),
        )
      : undefined;
  const { wallet, error, loading } = usePrivyWidgetWallet(chosen);
  const connect = () => {
    if (!ready) return;
    if (!authenticated) login();
    else connectWallet({ walletChainType: "ethereum-only" });
  };
  return (
    <main>
      <section>
        <div className="eyebrow">PRIVY + VIEM / TESTNET</div>
        <h1>
          Embedded or external.
          <br />
          One selected owner.
        </h1>
        <p>
          Log in, then explicitly choose the owner wallet used to create and
          manage LeverAccTrade.
        </p>
        <button disabled={!ready} onClick={connect}>
          {authenticated ? "Connect another wallet" : "Log in with Privy"}
        </button>
        {authenticated && (
          <>
            <label htmlFor="owner-wallet">Owner wallet</label>
            <select
              id="owner-wallet"
              value={chosen?.address ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select owner wallet</option>
              {wallets.map((w) => (
                <option key={w.address} value={w.address}>
                  {w.walletClientType}: {w.address}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setSelected("");
                void logout();
              }}
            >
              Log out
            </button>
          </>
        )}
        {loading && <p role="status">Preparing selected wallet…</p>}
        {error && <p role="alert">{error.message}</p>}
        <p>
          <small>
            Set your own registered project ID in this example before sending
            transactions.
          </small>
        </p>
        <h2>Integration events</h2>
        <pre>{event}</pre>
      </section>
      <div className="widget-slot">
        <ThemeSelector value={themeName} onChange={setThemeName} />
        <LeverAccWidget
          config={{ ...config, ...widgetThemes[themeName] }}
          wallet={wallet}
          onConnect={connect}
          onEvent={(e) => setEvent(JSON.stringify(e, null, 2))}
        />
      </div>
    </main>
  );
}
const appId = import.meta.env.VITE_PRIVY_APP_ID;
createRoot(document.getElementById("root")!).render(
  appId ? (
    <StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          supportedChains: [hyperliquidEvmTestnet, hyperliquid, arbitrum],
          defaultChain: hyperliquidEvmTestnet,
          loginMethods: ["wallet", "email"],
          embeddedWallets: {
            ethereum: { createOnLogin: "users-without-wallets" },
          },
        }}
      >
        <App />
      </PrivyProvider>
    </StrictMode>
  ) : (
    <main>
      <section>
        <h1>Configure Privy</h1>
        <p>
          Set VITE_PRIVY_APP_ID in .env.local using your own Privy app ID and
          allow this origin in the Privy dashboard. Restart the dev server.
        </p>
        <a href="../react/">Open wagmi example</a>
      </section>
    </main>
  ),
);
