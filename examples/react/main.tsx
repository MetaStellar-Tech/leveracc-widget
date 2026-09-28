import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WagmiProvider,
  createConfig,
  http,
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
} from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arbitrum, hyperliquid, hyperliquidEvmTestnet } from "viem/chains";
import {
  LeverAccWidget,
  widgetThemes,
  type WidgetThemeName,
  type LeverAccWidgetRef,
  type WidgetConfig,
} from "../../dist/index.js";
import { walletFromWagmi } from "../../dist/wallets.js";
import { useWidgetWallet } from "../../dist/wallets-react.js";
import "../shared.css";
import { ThemeSelector } from "../ThemeSelector";

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const wagmi = createConfig({
  chains: [hyperliquidEvmTestnet, hyperliquid, arbitrum],
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId })]
      : []),
  ],
  transports: {
    [hyperliquidEvmTestnet.id]: http(),
    [hyperliquid.id]: http(),
    [arbitrum.id]: http(),
  },
});
const queryClient = new QueryClient();
function App() {
  const ref = useRef<LeverAccWidgetRef>(null);
  const { address, connector, isConnected } = useConnection();
  const connect = useConnect(),
    connectors = useConnectors(),
    disconnect = useDisconnect();
  const create = useMemo(
    () =>
      isConnected && address && connector
        ? () => walletFromWagmi(connector, address)
        : undefined,
    [isConnected, address, connector],
  );
  const { wallet, error, loading } = useWidgetWallet(create);
  const [choose, setChoose] = useState(false),
    [event, setEvent] = useState("No events yet.");
  const [project, setProject] = useState(
    "0xb5aa45fa7dc556ccc2af82c0a6bb44407b32634c9b384862a27ccae5486fef91",
  );
  const [themeName, setThemeName] = useState<WidgetThemeName>("dark");
  const [config, setConfig] = useState<WidgetConfig>({
    projectId: project as `0x${string}`,
    network: "testnet",
    locale: "en",
  });
  return (
    <main>
      <section>
        <div className="eyebrow">WAGMI + VIEM / TESTNET</div>
        <h1>
          Your wallet.
          <br />
          The complete account flow.
        </h1>
        <p>
          Connect a browser wallet, or use WalletConnect when a project ID is
          configured. Account selection and reconnection are managed by wagmi.
        </p>
        <label htmlFor="locale">Widget language</label>
        <select
          id="locale"
          value={config.locale}
          onChange={(event) =>
            setConfig((current) => ({
              ...current,
              locale: event.target.value as "en" | "zh",
            }))
          }
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
        <label htmlFor="project">LeverAcc project ID</label>
        <input
          id="project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <button
          onClick={() =>
            setConfig({ ...config, projectId: project as `0x${string}` })
          }
        >
          Apply project
        </button>
        {isConnected ? (
          <>
            <p>Connected: {address}</p>
            <button onClick={() => disconnect.mutate()}>
              Disconnect wallet
            </button>
          </>
        ) : (
          <button onClick={() => setChoose(true)}>Choose wallet</button>
        )}
        {choose && !isConnected && (
          <div aria-label="Wallet selection">
            <h2>Choose a wallet</h2>
            {connectors.map((item) => (
              <button
                key={item.uid}
                disabled={connect.isPending}
                onClick={() =>
                  connect.mutate(
                    { connector: item },
                    { onSuccess: () => setChoose(false) },
                  )
                }
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        {(error || connect.error) && (
          <p role="alert">{error?.message || connect.error?.message}</p>
        )}
        {loading && <p role="status">Preparing connected wallet…</p>}
        <p>
          <small>
            Uses real testnet contracts. Supply a registered project and fund
            your wallet before submitting transactions.
          </small>
        </p>
        <a href="../privy/">Privy embedded / external wallet example</a>
        <button onClick={() => void ref.current?.refresh()}>
          Refresh account
        </button>
        <h2>Integration events</h2>
        <pre>{event}</pre>
      </section>
      <div className="widget-slot">
        <ThemeSelector
          value={themeName}
          onChange={(name) => {
            setThemeName(name);
            setConfig((current) => ({ ...current, ...widgetThemes[name] }));
          }}
        />
        <LeverAccWidget
          ref={ref}
          config={config}
          wallet={wallet}
          onConnect={() => setChoose(true)}
          onEvent={(e) => setEvent(JSON.stringify(e, null, 2))}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
