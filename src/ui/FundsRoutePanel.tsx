import { Skeleton } from "./Skeleton";
import type { ReactNode } from "react";
import { TokenIcon } from "./Icons";
import type { en } from "./strings";
export const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "--";
export function FundsRoutePanel({
  t,
  side,
  label,
  address,
  chain,
  owner,
  network,
  balance,
  balanceLabel,
  balanceLoading,
  amountLoading,
  amount,
  onAmount,
  onMax,
  disabled,
  accountControl,
  receiveLabel,
}: {
  t: typeof en;
  side: "source" | "destination";
  label: string;
  address?: string;
  chain?: string;
  owner?: boolean;
  network?: "arbitrum" | "hyperliquid" | "hyperevm";
  balance?: string;
  balanceLabel?: string;
  balanceLoading?: boolean;
  amountLoading?: boolean;
  amount: string;
  onAmount?: (value: string) => void;
  onMax?: () => void;
  disabled?: boolean;
  accountControl?: ReactNode;
  receiveLabel?: string;
}) {
  return (
    <section className="funds-card" aria-label={t[side]}>
      <div className="funds-meta">
        <span>{side === "source" ? t.routeFrom : t.routeTo}</span>
        <span>
          {balanceLabel ?? t.balance}{" "}
          <b>
            {balanceLoading ? (
              <Skeleton label={t.loading} />
            ) : (
              (balance ?? "--")
            )}{" "}
            USDC
          </b>
        </span>
      </div>
      <div className="funds-account">
        {accountControl ?? (
          <div className="funds-identity">
            {network ? (
              <TokenIcon name={network} size={32} />
            ) : (
              <span className={`account-badge ${owner ? "fund" : "trade"}`}>
                {owner ? "F" : "T"}
              </span>
            )}
            <div>
              <strong>
                {label}
                {network === "arbitrum" && chain && (
                  <span className="chain-label">{chain}</span>
                )}
              </strong>
              <small title={address}>
                {network !== "arbitrum" && chain && `${chain} · `}
                {shortAddress(address)}
              </small>
            </div>
          </div>
        )}
        <span className="token">
          <TokenIcon />
          <b>USDC</b>
        </span>
      </div>
      {onAmount ? (
        <div className="funds-amount">
          <input
            aria-label={t.amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            disabled={disabled}
            onChange={(e) => {
              if (/^\d*\.?\d{0,6}$/.test(e.target.value))
                onAmount(e.target.value);
            }}
          />
          <button
            disabled={disabled || !onMax}
            onClick={onMax}
            aria-label={t.max}
          >
            MAX
          </button>
        </div>
      ) : (
        <div className="funds-receive">
          <strong
            className={amount === "--" || amount === "0.00" ? "muted" : ""}
          >
            {amountLoading ? <Skeleton label={t.loading} /> : amount}
          </strong>
          <small>{receiveLabel ?? t.receiveLabel}</small>
        </div>
      )}
    </section>
  );
}
