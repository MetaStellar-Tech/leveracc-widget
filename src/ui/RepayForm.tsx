import { formatAmount } from "../core/amount";
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
  const repayable =
    debt === undefined || evm === undefined
      ? undefined
      : evm < debt
        ? evm
        : debt;
  const locked = busy || pending;
  const money = (value?: bigint) =>
    value === undefined ? "--" : formatAmount(value);
  const fillDebt = () => {
    if (debt === undefined) return;
    setFull(false);
    setAmount(formatAmount(debt));
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
        aria-label={busy ? undefined : t.repay}
        disabled={
          m.invalid ||
          debt === undefined ||
          debt <= 0n ||
          !units ||
          units > debt
        }
        onClick={m.execute}
      >
        {busy && <span className="loader" />}
        {busy ? t.submitting : t.repay}
      </button>
    </div>
  );
}
