import { ErrorToast } from "./ErrorToast";
import { CreationGasStep } from "./CreationGasStep";
import { Skeleton } from "./Skeleton";
import { Icon } from "./Icons";
import { useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import type { WidgetController } from "../core/controller";
import type { Snapshot } from "../types";
import type { en } from "./strings";
export function CreateAccountForm({
  controller: c,
  s,
  t,
  onDone,
}: {
  controller: WidgetController;
  s: Snapshot;
  t: typeof en;
  onDone: () => void;
}) {
  const context = `${s.owner}:${c.config.network}:${c.config.projectId}:${c.config.rpcUrl}:${c.config.protocolServiceUrl}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const sequence = useRef(0);
  const snapshot = useRef(s);
  snapshot.current = s;
  const mounted = useRef(false);
  const running = useRef<{ context: string; request: number } | undefined>(
    undefined,
  );
  const [result, setResult] = useState<{
    context: string;
    value?: Awaited<ReturnType<WidgetController["creationReadiness"]>>;
    error?: string;
  }>();
  const [checking, setChecking] = useState(true);
  async function refresh() {
    if (
      snapshot.current.busy ||
      (snapshot.current.status === "ready" && snapshot.current.account)
    )
      return;
    if (!mounted.current || currentContext.current !== context) return;
    if (running.current?.context === context) return;
    const request = ++sequence.current;
    running.current = { context, request };
    setChecking(true);
    try {
      const value = await c.creationReadiness();
      if (request === sequence.current && currentContext.current === context) {
        setResult({ context, value });
      }
    } catch (e) {
      if (request === sequence.current && currentContext.current === context) {
        setResult({
          context,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      if (running.current?.request === request) running.current = undefined;
      if (request === sequence.current && currentContext.current === context)
        setChecking(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setResult(undefined);
    void refresh();

    return () => {
      mounted.current = false;
      ++sequence.current;
      running.current = undefined;
    };
  }, [c, context]);
  const current = result?.context === context ? result : undefined;
  const gas = current?.value?.gas,
    error = current?.error ?? current?.value?.funding?.error;
  const done = s.status === "ready" && Boolean(s.account),
    gasReady = current?.value?.ready === true,
    pending = checking || !current,
    blocked = pending || !!error;
  const source = c.config.network === "mainnet" ? "Arbitrum" : "HyperCore";
  const topUp = () => {
    void c
      .topUpGas()
      .then(() => refresh())
      .catch((e) => {
        if (mounted.current && currentContext.current === context)
          setResult({
            context,
            error: e instanceof Error ? e.message : String(e),
          });
      });
  };
  return (
    <div className="creation-steps">
      <div className="step">
        <span className={`step-badge ${gasReady || done ? "complete" : ""}`}>
          <Icon name={gasReady || done ? "check" : "fuel"} />
        </span>
        <div>
          <h3>{t.gasStep}</h3>
          {gasReady || done ? (
            <p>{t.gasReady}</p>
          ) : c.usesBuiltInGasTopUp ? (
            <CreationGasStep
              source={source}
              t={t}
              disabled={blocked || s.busy}
              submitting={s.busy}
              onFund={topUp}
            />
          ) : (
            <>
              <p>{pending ? <Skeleton label={t.loading} /> : t.gasRequired}</p>
              {gas !== undefined && (
                <p className="mono">{formatEther(gas)} HYPE</p>
              )}
              <code className="owner-address">{s.owner}</code>
              {c.hasGasTopUp && (
                <button
                  className="primary"
                  disabled={blocked || s.busy}
                  onClick={topUp}
                >
                  {s.busy ? t.preparing : t.topUpGas}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="step">
        <span
          className={`step-badge ${done ? "complete" : gasReady ? "active" : ""}`}
        >
          <Icon name={done ? "check" : "pen"} />
        </span>
        <div>
          <h3 className={!done && !gasReady ? "creation-inactive" : undefined}>
            {t.signCreate}
          </h3>
          {(done || gasReady) && (
            <p>{done ? t.accountCreated : t.createDescription}</p>
          )}
          {!done && gasReady && (
            <button
              className="primary"
              disabled={
                !gasReady || blocked || s.busy || s.status !== "noAccount"
              }
              onClick={() => void c.createAccount()}
            >
              {s.busy ? (
                <>
                  <span className="loader" />
                  {t.preparing}
                </>
              ) : (
                <>
                  <Icon name="pen" />
                  {t.signCreate}
                </>
              )}
            </button>
          )}
          {done && (
            <button className="primary success-button" onClick={onDone}>
              {t.done}
            </button>
          )}
        </div>
      </div>
      <button
        className="text-button"
        disabled={checking || s.busy}
        onClick={() => {
          void c.refresh();
          void refresh();
        }}
      >
        {t.refreshStatus}
      </button>
      {error && error !== s.error && error !== s.operation?.error && (
        <ErrorToast key={error} closeLabel={t.close}>
          <p role="alert" className="error-text">
            {error}
          </p>
        </ErrorToast>
      )}
    </div>
  );
}
