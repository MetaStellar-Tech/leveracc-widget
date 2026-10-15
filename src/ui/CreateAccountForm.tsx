import { GaslessEthStep } from "./GaslessEthStep";
import { creationCopy } from "./creation-copy";
import { creationFlow } from "../protocol/creation-policy";
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
  t: translations,
  onDone,
}: {
  controller: WidgetController;
  s: Snapshot;
  t: typeof en;
  onDone: () => void;
}) {
  const t = creationCopy(c.config, translations);
  const flow = creationFlow(c.config);
  const context = `${s.owner}:${c.config.network}:${c.config.projectId}:${c.config.rpcUrl}:${c.config.arbitrumRpcUrl}:${c.config.protocolServiceUrl}:${c.config.skipCreationTopUpCheck}:${flow}:${c.config.creationLegacyMode}:${c.config.creationGaslessEthEnabled}:${c.config.creationGaslessEthAmountUsdc}:${c.usesBuiltInGasTopUp}`;
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
  const statusFailures = useRef(0);
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
        statusFailures.current =
          value.gasless?.pending &&
          value.gasless.error &&
          value.gasless.autoPoll !== false
            ? statusFailures.current + 1
            : 0;
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
    statusFailures.current = 0;
    void refresh();

    return () => {
      mounted.current = false;
      ++sequence.current;
      running.current = undefined;
    };
  }, [c, context]);
  useEffect(() => {
    if (checking || s.busy || (s.status === "ready" && s.account)) return;
    const value = result?.context === context ? result.value : undefined;
    if (
      (!s.creationPending && value?.ready) ||
      value?.funding?.state === "failed" ||
      value?.gasless?.autoPoll === false
    )
      return;
    const timer = setTimeout(
      () => {
        void (async () => {
          await c.refresh();
          await refresh();
        })();
      },
      s.creationPending || value?.creating
        ? 3000
        : Math.max(
            value?.gasless?.pollAfter ?? value?.funding?.pollAfter ?? 5000,
            statusFailures.current
              ? Math.min(60000, 5000 * 2 ** Math.min(statusFailures.current, 4))
              : 0,
          ),
    );
    return () => clearTimeout(timer);
  }, [
    c,
    context,
    result,
    s.busy,
    s.status,
    s.account,
    s.creationPending,
    checking,
  ]);
  const current = result?.context === context ? result : undefined;
  const gas = current?.value?.gas,
    error = current?.error ?? current?.value?.funding?.error;
  const done = s.status === "ready" && Boolean(s.account),
    creating = current?.value?.creating === true || s.creationPending === true,
    fundingPending =
      current?.value?.funding?.state === "pending" ||
      current?.value?.funding?.state === "failed" ||
      s.creationFundingPending === true,
    gasReady = current?.value?.ready === true || creating,
    pending = checking || !current,
    blocked = pending || !!error;
  const loadingGasless =
    !current?.value &&
    !s.creationPending &&
    !s.creationFundingPending &&
    c.config.creationGaslessEthEnabled &&
    c.config.network === "mainnet" &&
    c.usesBuiltInGasTopUp;
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
      {flow !== "none" && (
        <div className="step">
          <span className={`step-badge ${gasReady || done ? "complete" : ""}`}>
            <Icon name={gasReady || done ? "check" : "fuel"} />
          </span>
          <div>
            <h3>{t.gasStep}</h3>
            {gasReady || done ? (
              <p>{t.gasReady}</p>
            ) : loadingGasless ||
              (current?.value?.gasless && !current.value.gasless.ready) ? (
              <GaslessEthStep
                controller={c}
                state={
                  current?.value?.gasless ?? {
                    ready: false,
                    pending: false,
                    disabled: true,
                    pollAfter: 10000,
                  }
                }
                busy={s.busy}
                onRefresh={refresh}
              />
            ) : c.usesBuiltInGasTopUp ? (
              <CreationGasStep
                source={source}
                activationOnly={flow === "activation_only"}
                t={t}
                disabled={blocked || s.busy || fundingPending}
                pending={fundingPending}
                failure={
                  current?.value?.funding?.state === "failed"
                    ? error
                    : undefined
                }
                submitting={s.busy}
                onFund={topUp}
              />
            ) : (
              <>
                <p>
                  {pending ? <Skeleton label={t.loading} /> : t.gasRequired}
                </p>
                {c.config.creationGasConversionEnabled !== false &&
                  gas !== undefined && (
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
      )}
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
          {!done && creating && <p role="status">{t.creationPending}</p>}
          {!done && gasReady && !creating && (
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
      {error &&
        current?.value?.funding?.state !== "failed" &&
        error !== s.error &&
        error !== s.operation?.error && (
          <ErrorToast key={error} closeLabel={t.close}>
            <p role="alert" className="error-text">
              {error}
            </p>
          </ErrorToast>
        )}
    </div>
  );
}
