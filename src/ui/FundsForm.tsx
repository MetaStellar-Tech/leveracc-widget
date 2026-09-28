import { CopyAddressButton } from "./CopyAddressButton";
import { Skeleton } from "./Skeleton";
import type { useWidgetForm } from "./useWidgetForm";
import { formatAmount } from "../core/amount";
import { FundsRoutePanel, shortAddress } from "./FundsRoutePanel";
import { Icon } from "./Icons";
export function FundsForm({
  model: m,
}: {
  model: ReturnType<typeof useWidgetForm>;
}) {
  const {
    t,
    s,
    tab,
    amount,
    setAmount,
    route,
    setRoute,
    depositRoute,
    setDepositRoute,
    fee,
    approved,
    busy,
    pending,
    isBridge,
    units,
    available,
    invalid,
  } = m;
  const arbitrumLabel =
    m.config.network === "testnet" ? "Arbitrum Sepolia" : "Arbitrum";
  const evmLabel =
    m.config.network === "testnet" ? "HyperEVM Testnet" : "HyperEVM";
  const deposit = tab === "deposit",
    forward = route === "fundToTrade";
  const flow =
    s.continuation?.action === "transfer" &&
    s.continuation.stage === "awaitingAction" &&
    tab === "transfer"
      ? s.continuation.transferFlow
      : undefined;
  const activation =
    !deposit && forward && s.reasons.includes("CORE_ACTIVATION_REQUIRED")
      ? 1000000n
      : 0n;
  const received =
    units && (!isBridge || fee !== undefined)
      ? units - (isBridge ? fee! : activation)
      : undefined;
  const money = (value?: bigint) =>
    value === undefined ? "--" : formatAmount(value);
  const locked = busy || pending || !!flow;
  const depositProgress =
    deposit &&
    pending &&
    (s.operation?.action === "deposit" ||
      s.operation?.action === "bridgeApproval")
      ? s.operation.stage
      : undefined;
  const sourceOwner = deposit || forward;
  const sourceLabel = deposit
    ? isBridge
      ? arbitrumLabel
      : "HyperCore"
    : forward
      ? t.fundLabel
      : t.tradeLabel;
  const sourceChain = deposit
    ? undefined
    : forward
      ? "HyperEVM"
      : "LA · HyperEVM + HyperCore";
  const targetOwner = deposit || !forward;
  return (
    <div className="funds-form">
      {deposit && (
        <>
          <div className="deposit-warning">
            <Icon name="info" />
            <p>{t.depositWarning}</p>
          </div>
          <div className="connected-wallet">
            <span className="wallet-badge">
              <Icon name="wallet" />
            </span>
            <div>
              <small>{t.connectedAccount}</small>
              <code title={s.owner}>{shortAddress(s.owner)}</code>
            </div>
            <CopyAddressButton
              address={s.owner}
              copyLabel={t.copy}
              copiedLabel={t.copied}
              onError={(error) => void m.invoke(() => Promise.reject(error))}
            />
          </div>
          <div className="deposit-methods" role="group" aria-label={t.route}>
            {(["arbitrum", "core"] as const).map((method) => (
              <button
                key={method}
                aria-pressed={depositRoute === method}
                disabled={locked}
                onClick={() => {
                  setDepositRoute(method);
                  setAmount("");
                }}
              >
                {method === "arbitrum" && (
                  <span className="recommended">{t.recommended}</span>
                )}
                <strong>
                  {method === "arbitrum" ? t.externalWallet : "Hyperliquid"}
                </strong>
                <small>
                  {method === "arbitrum" ? arbitrumLabel : "HyperCore"} →{" "}
                  {evmLabel}
                </small>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="funds-route-stack">
        <FundsRoutePanel
          t={t}
          side="source"
          label={sourceLabel}
          owner={sourceOwner}
          network={
            deposit ? (isBridge ? "arbitrum" : "hyperliquid") : undefined
          }
          chain={sourceChain}
          address={sourceOwner ? s.owner : s.account}
          balanceLoading={m.balanceLoading}
          balance={money(available)}
          amount={flow?.amount ? formatAmount(BigInt(flow.amount)) : amount}
          disabled={locked}
          onAmount={setAmount}
          onMax={
            available === undefined
              ? undefined
              : () => setAmount(money(available))
          }
        />
        <div className="route-switch">
          <button
            className="reverse-route"
            aria-label={t.reverse}
            disabled={locked || deposit}
            onClick={() => {
              setRoute(forward ? "accountToFund" : "fundToTrade");
              setAmount("");
            }}
          >
            <Icon name={deposit ? "down" : "transfer"} />
          </button>
        </div>
        <FundsRoutePanel
          t={t}
          side="destination"
          amountLoading={m.quoting}
          label={deposit ? evmLabel : targetOwner ? t.fundLabel : t.tradeLabel}
          owner={targetOwner}
          network={deposit ? "hyperevm" : undefined}
          chain={
            deposit ? undefined : targetOwner ? "HyperEVM" : "HyperCore Spot"
          }
          address={targetOwner ? s.owner : s.account}
          balanceLoading={m.s.status === "loading"}
          balance={money(targetOwner ? s.balances?.fund : s.balances?.spot)}
          amount={
            received !== undefined && received > 0n
              ? money(received)
              : isBridge || units
                ? "--"
                : "0.00"
          }
        />
      </div>
      <div className="funds-estimates">
        <span>{t.time} --</span>
        <span>
          {isBridge ? t.fee : t.feeLabel}{" "}
          {m.quoting ? (
            <Skeleton label={t.loading} />
          ) : fee === undefined ? (
            "--"
          ) : (
            money(fee)
          )}
          {isBridge ? " USDC" : ""}
        </span>
      </div>
      {activation > 0n && <p className="notice">{t.activationNote}</p>}
      <button
        className="primary"
        aria-live={deposit ? "polite" : undefined}
        aria-atomic={deposit ? true : undefined}
        aria-label={
          !depositProgress && !flow && !busy && !(isBridge && !approved)
            ? t[tab]
            : undefined
        }
        disabled={
          flow ? busy || s.continuation?.stage !== "awaitingAction" : invalid
        }
        onClick={flow ? () => void m.invoke(m.continueTransfer) : m.execute}
      >
        {(busy || depositProgress) && (
          <span className="loader" aria-hidden="true" />
        )}
        {depositProgress
          ? t[depositProgress]
          : flow
            ? t.continueTransfer
            : busy
              ? t.submitting
              : isBridge && !approved
                ? t.approve
                : deposit
                  ? t.depositAction
                  : units
                    ? `${t.transfer} ${formatAmount(units)} USDC`
                    : forward
                      ? t.transferToTrade
                      : t.transferToFund}
      </button>
      {deposit && (
        <p className="powered">{isBridge ? t.poweredCircle : t.poweredCore}</p>
      )}
    </div>
  );
}
