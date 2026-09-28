import { Icon } from "./Icons";
import { CopyAddressButton } from "./CopyAddressButton";
import { CollateralInfo } from "./CollateralInfo";
import { formatAmount } from "../core/amount";
import type { Snapshot } from "../types";
import type { en } from "./strings";
export function AccountSummary({
  s,
  t,
  enabled,
  onCopyError,
}: {
  s: Snapshot;
  t: Record<keyof typeof en, string>;
  enabled: boolean;
  onCopyError: (error: unknown) => void;
}) {
  const metric = (value?: bigint) =>
    value === undefined ? "—" : formatAmount(value);
  return (
    <div className="account-area account-board">
      <div className="account-cell">
        <div className="account-identity">
          <Icon name="wallet" size={18} />
          <div>
            <strong>{t.tradingAccount}</strong>
            <span className="account-kind">LeverAccTrade</span>
          </div>
        </div>
        <div className="account-address">
          <code className="account-short">
            {s.account
              ? `${s.account.slice(0, 6)}…${s.account.slice(-4)}`
              : "—"}
          </code>
          {enabled && (
            <CopyAddressButton
              address={s.account}
              copyLabel={t.copy}
              copiedLabel={t.copied}
              onError={onCopyError}
            />
          )}
        </div>
      </div>
      <dl className="account-metrics">
        <div>
          <dt>
            {t.collateral}
            <CollateralInfo
              breakdown={s.overview?.collateralBreakdown}
              label={t.collateralBreakdown}
            />
          </dt>
          <dd>
            {metric(s.overview?.collateral)} <small>USDC</small>
          </dd>
        </div>
        <div className="borrowed">
          <dt>{t.borrowed}</dt>
          <dd>
            {metric(s.balances?.debt)} <small>USDC</small>
          </dd>
        </div>
        <div className="trading">
          <dt title={t.tradingHint}>{t.tradingAvailable}</dt>
          <dd>
            {metric(s.overview?.tradingAvailable)} <small>USDC</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}
