import { repayAvailable } from "../protocol/repay-flow";
import { formatAmount, repayCeiling } from "../core/amount";
import { Skeleton } from "./Skeleton";
import type { useWidgetForm } from "./useWidgetForm";

export function RepayForm({
  model: m,
}: {
  model: ReturnType<typeof useWidgetForm>;
}) {
  const { t, s, amount, setAmount, setFull, units, busy, pending, id } = m;
  const debt = s.balances?.debt;
  const evm = s.balances?.evm;
  const repayable = s.balances
    ? repayAvailable(s.balances.evm, s.balances.spot, s.balances.debt)
    : undefined;
  const flow =
    s.operation?.action === "repay" ? s.operation.repayFlow : undefined;
  const retry = s.continuation?.action === "repay";
  const locked = busy || pending || retry;
  const label = !busy
    ? retry
      ? t.repayRetry
      : t.repay
    : flow?.step === "repayConfirming"
      ? t.repayConfirming
      : flow?.step === "topup"
        ? t.repayTopup
        : flow?.step === "confirming" || flow?.step === "arrival"
          ? t.repayArrival
          : s.operation?.stage === "submitting"
            ? t.repaySubmitting
            : t.repaySigning;
  const money = (value?: bigint) =>
    value === undefined ? "--" : formatAmount(value);
  const fillDebt = () => {
    if (debt === undefined) return;
    setFull(true);
    setAmount(formatAmount(repayCeiling(debt)));
  };
  return (
    <div className="repay-form">
      <div className="repay-balance-list">
        {(
          [
            [t.repayCoreAvailable, s.balances?.spot],
            [t.repayAccountEvm, evm],
            [t.repayRealtimeDebt, debt],
            [t.repayAvailable, repayable],
          ] as const
        ).map(([label, value]) => (
          <div className="meta" key={label}>
            <span>{label}</span>
            <span>
              {s.status === "loading" ? (
                <Skeleton label={t.loading} />
              ) : (
                money(value)
              )}{" "}
              USDC
            </span>
          </div>
        ))}
      </div>
      <div className="meta repay-current">
        <span>{t.repayCurrentBorrowed}</span>
        <button
          className="text-button"
          disabled={locked || debt === undefined || debt <= 0n}
          onClick={fillDebt}
        >
          <span>
            {s.status === "loading" ? (
              <Skeleton label={t.loading} />
            ) : (
              money(debt)
            )}
          </span>
          <small> USDC</small>
        </button>
      </div>
      <label className="field" htmlFor={`${id}-amount`}>
        {t.amount}
      </label>
      <div className="amount">
        <input
          id={`${id}-amount`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          disabled={locked}
          onChange={(event) => {
            setFull(false);
            setAmount(event.target.value);
          }}
        />
      </div>
      <button
        className="primary"
        aria-label={busy ? undefined : retry ? t.repayRetry : t.repay}
        disabled={
          retry
            ? busy || pending || !!flow?.submissionUnknown
            : m.invalid ||
              debt === undefined ||
              debt <= 0n ||
              !units ||
              (!m.full && units > debt)
        }
        onClick={m.execute}
      >
        {busy && <span className="loader" />}
        {label}
      </button>
    </div>
  );
}
