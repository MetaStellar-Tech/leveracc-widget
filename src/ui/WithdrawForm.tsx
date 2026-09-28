import { Skeleton } from "./Skeleton";
import type { useWidgetForm } from "./useWidgetForm";
import { formatAmount } from "../core/amount";
import { FundsRoutePanel } from "./FundsRoutePanel";
import { WithdrawalSource } from "./WithdrawalSource";
import { Icon } from "./Icons";
export function WithdrawForm({
  model: m,
}: {
  model: ReturnType<typeof useWidgetForm>;
}) {
  const {
    t,
    s,
    config,
    route,
    setRoute,
    amount,
    setAmount,
    units,
    fee,
    busy,
    pending,
    available,
  } = m;
  const fund = route === "fundToArbitrum",
    locked =
      busy ||
      pending ||
      (s.continuation?.action === "withdraw" &&
        s.continuation.stage === "awaitingAction");
  const money = (value?: bigint) =>
    value === undefined ? "--" : formatAmount(value);
  const address = fund ? s.owner : s.account;
  const activeBridge =
    pending && s.operation?.action === "withdraw"
      ? s.operation.bridge
      : undefined;
  const displayedFee = activeBridge
    ? BigInt(activeBridge.maxFee)
    : pending && s.operation?.arbitrumWithdrawal
      ? BigInt(s.operation.arbitrumWithdrawal.fee)
      : fee;
  const net =
    units && displayedFee !== undefined && units > displayedFee
      ? units - displayedFee
      : undefined;
  const bridge =
    s.operation?.action === "withdraw" ? s.operation.bridge : undefined;
  const flow =
    s.continuation?.action === "withdraw" &&
    s.continuation.stage === "awaitingAction"
      ? (s.continuation.arbitrumWithdrawal ?? s.continuation.transferFlow)
      : undefined;
  const legacy =
    !!s.continuation?.transferFlow && s.continuation.action === "withdraw";
  const complete =
    bridge?.completed && amount === formatAmount(BigInt(bridge.amount));
  const displayAmount = flow ? formatAmount(BigInt(flow.amount)) : amount;
  return (
    <div className="withdraw-form">
      <div className="funds-route-stack withdraw-stack">
        <FundsRoutePanel
          t={t}
          side="source"
          label={fund ? t.withdrawFundLabel : t.withdrawTradeLabel}
          address={address}
          owner={fund}
          balanceLabel={fund ? t.balance : t.withdrawable}
          balanceLoading={m.balanceLoading}
          balance={money(available)}
          amount={displayAmount}
          disabled={locked}
          onAmount={setAmount}
          onMax={
            available === undefined
              ? undefined
              : () => setAmount(money(available))
          }
          accountControl={
            <WithdrawalSource
              fund={fund}
              owner={s.owner}
              account={s.account}
              disabled={locked}
              t={t}
              onChange={(value) => {
                setRoute(value ? "fundToArbitrum" : "tradeToArbitrum");
                setAmount("");
              }}
            />
          }
        />
        <div className="route-switch">
          <span className="reverse-route">
            <Icon name="down" />
          </span>
        </div>
        <FundsRoutePanel
          t={t}
          side="destination"
          amountLoading={m.quoting}
          label={t.withdrawFundLabel}
          network={legacy ? "hyperevm" : "arbitrum"}
          chain={
            legacy
              ? config.network === "testnet"
                ? "HyperEVM Testnet"
                : "HyperEVM"
              : config.network === "testnet"
                ? "Arbitrum Sepolia"
                : "Arbitrum"
          }
          address={s.owner}
          balanceLoading={
            m.s.status === "loading" || (!legacy && m.arbitrumLoading)
          }
          balance={money(legacy ? s.balances?.fund : m.arbitrumBalance)}
          receiveLabel={t.receive}
          amount={
            complete
              ? money(
                  bridge.receivedAmount
                    ? BigInt(bridge.receivedAmount)
                    : undefined,
                )
              : !units
                ? "0.00"
                : money(net)
          }
        />
      </div>
      <div className="funds-estimates">
        <span>
          {t.time} {legacy ? "--" : t.withdrawTime}
        </span>
        <span>
          {t.withdrawFeeLabel}{" "}
          {m.quoting ? <Skeleton label={t.loading} /> : money(displayedFee)}{" "}
          USDC
        </span>
      </div>
      {!legacy && !fund && !config.arbitrumWithdrawalEnabled && (
        <p role="note">{t.arbUnavailable}</p>
      )}
      <button
        className="primary"
        aria-label={
          !flow && !complete && !busy && !(fund && !m.approved)
            ? t.withdraw
            : undefined
        }
        disabled={
          flow
            ? busy ||
              m.quoting ||
              fee === undefined ||
              BigInt(flow.amount) <= fee ||
              s.status !== "ready" ||
              s.continuation?.stage !== "awaitingAction"
            : m.invalid || !!complete
        }
        onClick={flow ? m.continueWithdrawal : m.execute}
      >
        {busy && <span className="loader" />}
        {flow
          ? t.continueWithdrawal
          : complete
            ? t.done
            : busy
              ? t.submitting
              : fund && !m.approved
                ? t.approve
                : t.withdrawAction}
      </button>
      {!legacy && <p className="powered">{t.poweredCircle}</p>}
    </div>
  );
}
