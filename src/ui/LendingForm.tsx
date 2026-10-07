import { ErrorToast } from "./ErrorToast";
import { Skeleton } from "./Skeleton";
import { useEffect } from "react";
import type { useWidgetForm } from "./useWidgetForm";
import { formatAmount } from "../core/amount";
export function LendingForm({
  model: m,
}: {
  model: ReturnType<typeof useWidgetForm>;
}) {
  const {
    t,
    s,
    config,
    tab,
    amount,
    setAmount,
    units,
    busy,
    pending,
    invalid,
    execute,
    borrowQuote,
    loadBorrowQuote,
    id,
  } = m;
  useEffect(() => {
    if (tab === "borrow" && s.status === "ready") void loadBorrowQuote();
  }, [tab, s.status, s.owner, config.projectId]);
  const maximum = s.balances?.borrowable ?? 0n,
    minimum = s.minimumBorrow ?? 0n;
  const floor =
    maximum > 0n
      ? Math.max(
          0,
          Math.min(400, Number((minimum * 400n + maximum - 1n) / maximum)),
        )
      : 0;
  const percent =
    maximum > 0n && units
      ? Math.min(400, Math.max(0, Number((units * 400n) / maximum)))
      : 0;
  const unavailable = busy || pending || maximum <= 0n || minimum > maximum;
  function applyPercent(value: number) {
    if (unavailable) return;
    if (value === 0) {
      setAmount("0.000000");
      return;
    }
    const raw = (maximum * BigInt(Math.max(floor, value))) / 400n;
    setAmount(formatAmount(raw < minimum ? minimum : raw));
  }
  return (
    <div className="lending-form borrow">
      <div className="meta available">
        <span>{t.capacity}</span>
        <button
          className="text-button"
          disabled={unavailable}
          onClick={() => setAmount(formatAmount(maximum))}
        >
          {s.status === "loading" ? (
            <Skeleton label={t.loading} />
          ) : (
            Number(formatAmount(maximum)).toLocaleString(config.locale)
          )}{" "}
          <span>USDC</span>
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
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy || pending}
        />
      </div>
      <div className="slider-markers">
        {[0, 100, 200, 300, 400].map((marker) => (
          <button
            key={marker}
            className={Math.round(percent) === marker ? "selected" : ""}
            disabled={unavailable}
            onClick={() => applyPercent(marker)}
          >
            {marker}%
          </button>
        ))}
      </div>
      <input
        className="borrow-slider"
        style={{
          background: `linear-gradient(to right, var(--accent) ${percent / 4}%, var(--slider-track) ${percent / 4}%)`,
        }}
        type="range"
        aria-label={t.borrowRatio}
        min={0}
        max={400}
        step={1}
        value={percent}
        disabled={unavailable}
        onChange={(e) => applyPercent(Number(e.target.value))}
      />
      {units && units < minimum && (
        <ErrorToast closeLabel={t.close}>
          <p className="error-text" role="alert">
            {t.minimumBorrow}: {formatAmount(minimum)} USDC
          </p>
        </ErrorToast>
      )}
      {!!units && (
        <div className="borrow-terms">
          <div className="meta">
            <span>{t.dailyRate}</span>
            <span>
              {m.borrowLoading ? (
                <Skeleton label={t.loading} />
              ) : borrowQuote ? (
                `${(borrowQuote.dailyRatePpm / 10_000_000).toFixed(4)}%`
              ) : (
                "--"
              )}
            </span>
          </div>
        </div>
      )}
      <div className="borrow-actions">
        <button
          className="primary"
          aria-label={busy ? undefined : t.borrow}
          disabled={
            invalid ||
            !borrowQuote ||
            !units ||
            units < minimum ||
            units > maximum
          }
          onClick={execute}
        >
          {busy && <span className="loader" />}
          {busy ? t.submitting : t.borrowAction}
        </button>
      </div>
      {!!units && <p className="note">{t.borrowNote}</p>}
    </div>
  );
}
