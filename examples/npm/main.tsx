import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LeverAccWidget,
  widgetThemes,
  type WidgetConfig,
  type WidgetHandle,
  type WidgetOptions,
  type WidgetThemeName,
  type WalletProvider,
} from "@leveracc/widget";
import { mountLeverAccWidget } from "@leveracc/widget/embed";
import "./style.css";

// The imperative API can be used in plain JavaScript, Vue or another framework.
function EmbedWidget(options: WidgetOptions) {
  const element = useRef<HTMLDivElement>(null);
  const handle = useRef<WidgetHandle | undefined>(undefined);
  useEffect(() => {
    handle.current = mountLeverAccWidget(element.current!, options);
    return () => {
      handle.current?.destroy();
      handle.current = undefined;
    };
  }, []);
  useEffect(() => {
    handle.current?.update(options);
  }, [options]);
  return <div ref={element} />;
}

const initialProject =
  "0xb5aa45fa7dc556ccc2af82c0a6bb44407b32634c9b384862a27ccae5486fef91";
function App() {
  const [integration, setIntegration] = useState("react");
  const [theme, setTheme] = useState<WidgetThemeName>("dark");
  const [locale, setLocale] = useState<"en" | "zh">("zh");
  const [project, setProject] = useState(initialProject);
  const [projectId, setProjectId] =
    useState<WidgetConfig["projectId"]>(initialProject);
  const [wallet, setWallet] = useState<WalletProvider>();
  const [message, setMessage] = useState("");
  const [event, setEvent] = useState("尚无事件");
  const config = useMemo<WidgetConfig>(
    () => ({
      projectId,
      network: "testnet",
      locale,
      ...widgetThemes[theme],
    }),
    [projectId, locale, theme],
  );
  const connect = useCallback(async () => {
    const provider = (window as Window & { ethereum?: WalletProvider })
      .ethereum;
    if (!provider) {
      setMessage("请安装浏览器钱包，或在宿主应用中传入 EIP-1193 provider。");
      return;
    }
    try {
      await provider.request({ method: "eth_requestAccounts" });
      setWallet(provider);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "钱包连接失败");
    }
  }, []);
  const onEvent = useCallback<NonNullable<WidgetOptions["onEvent"]>>(
    (event) => {
      setEvent(JSON.stringify(event, null, 2));
    },
    [],
  );
  const options = { config, wallet, onConnect: connect, onEvent };
  return (
    <main>
      <section>
        <div className="eyebrow">NPM PACKAGE / TESTNET</div>
        <h1>安装包，直接集成。</h1>
        <p>
          通过 npm 安装的 @leveracc/widget，切换 React 与 embed
          入口查看实际效果。
        </p>
        <label htmlFor="integration">集成方式</label>
        <select
          id="integration"
          value={integration}
          onChange={(event) => setIntegration(event.target.value)}
        >
          <option value="react">React 组件</option>
          <option value="embed">embed 挂载 API</option>
        </select>
        <label htmlFor="locale">语言</label>
        <select
          id="locale"
          value={locale}
          onChange={(event) => setLocale(event.target.value as "en" | "zh")}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
        <label htmlFor="project">项目 ID</label>
        <input
          id="project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        />
        <button
          onClick={() => {
            if (!/^0x[\da-f]{64}$/i.test(project)) {
              setMessage("项目 ID 必须为 0x 开头的 32 字节十六进制值。");
              return;
            }
            setProjectId(project as WidgetConfig["projectId"]);
            setMessage("");
          }}
        >
          应用项目 ID
        </button>
        <p>进行业务操作前，请替换为目标网络中已注册的项目 ID。</p>
        <button onClick={() => void connect()}>连接宿主钱包</button>
        {wallet && (
          <button onClick={() => setWallet(undefined)}>断开组件钱包</button>
        )}
        {message && <p role="alert">{message}</p>}
        <h2>集成事件</h2>
        <pre>{event}</pre>
      </section>
      <div className="widget-slot">
        <div className="theme-preview">
          <label htmlFor="theme">主题配色</label>
          <select
            id="theme"
            value={theme}
            onChange={(event) =>
              setTheme(event.target.value as WidgetThemeName)
            }
          >
            <option value="dark">默认暗色</option>
            <option value="light">默认亮色</option>
            <option value="midnight">午夜蓝暗色</option>
            <option value="lavender">薰衣草亮色</option>
          </select>
        </div>
        {integration === "react" ? (
          <LeverAccWidget {...options} />
        ) : (
          <EmbedWidget {...options} />
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
