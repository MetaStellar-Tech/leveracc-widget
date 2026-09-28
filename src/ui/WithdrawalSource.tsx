import { useId, useRef, useState } from "react";
import { Icon } from "./Icons";
import { shortAddress } from "./FundsRoutePanel";
import type { en } from "./strings";
export function WithdrawalSource({
  fund,
  owner,
  account,
  disabled,
  onChange,
  t,
}: {
  fund: boolean;
  owner?: string;
  account?: string;
  disabled: boolean;
  onChange: (fund: boolean) => void;
  t: typeof en;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null);
  const choose = (value: boolean) => {
    onChange(value);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="source-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="source-selector"
        role="combobox"
        aria-label={t.selectSource}
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setActive(fund ? 0 : 1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((value) => (open ? 1 - value : fund ? 0 : 1));
          } else if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            choose(active === 0);
          }
        }}
      >
        <span className={`account-badge ${fund ? "fund" : "trade"}`}>
          {fund ? "F" : "T"}
        </span>
        <span className="source-label">
          <span>
            {fund ? t.withdrawFundLabel : t.withdrawTradeLabel}
            <span className="chain-label">
              {fund ? "HyperEVM" : "HyperEVM / HyperCore"}
            </span>
          </span>
          <small title={fund ? owner : account}>
            {shortAddress(fund ? owner : account)}
          </small>
        </span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div
          className="source-options"
          role="listbox"
          id={id}
          aria-label={t.selectSource}
        >
          {[true, false].map((value, i) => (
            <div
              role="option"
              id={`${id}-${i}`}
              key={i}
              aria-selected={fund === value}
              className={active === i ? "active" : ""}
              onPointerMove={() => setActive(i)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(value)}
            >
              {value ? t.withdrawFundLabel : t.withdrawTradeLabel}{" "}
              <small>({value ? "HyperEVM" : "HyperCore"})</small>
              {fund === value && <Icon name="check" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
