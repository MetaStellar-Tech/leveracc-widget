import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icons";
import { formatAmount } from "../core/amount";
import type { Snapshot } from "../types";
export function CollateralInfo({
  breakdown,
  label,
}: {
  breakdown: NonNullable<Snapshot["overview"]>["collateralBreakdown"];
  label: string;
}) {
  const id = useId(),
    popup = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    popup.current?.hidePopover();
  };
  const show = () => {
    clearTimeout(timer.current);
    const el = popup.current,
      button = trigger.current;
    if (!el || !button) return;
    const rect = button.getBoundingClientRect();
    el.style.width = `${Math.min(240, window.innerWidth - 24)}px`;
    el.showPopover();
    el.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - el.offsetWidth - 12))}px`;
    el.style.top = `${Math.max(12, rect.top - el.offsetHeight - 8 >= 12 ? rect.top - el.offsetHeight - 8 : Math.min(rect.bottom + 8, window.innerHeight - el.offsetHeight - 12))}px`;
  };
  const leave = () => {
    timer.current = setTimeout(hide, 150);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const outside = (e: PointerEvent) => {
      if (
        !e.composedPath().includes(trigger.current!) &&
        !e.composedPath().includes(popup.current!)
      )
        hide();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return (
    <>
      <button
        ref={trigger}
        className="collateral-info"
        aria-label={label}
        aria-describedby={id}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") show();
        }}
        onPointerLeave={leave}
        onFocus={show}
        onBlur={hide}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") e.preventDefault();
        }}
        onClick={() =>
          popup.current?.matches(":popover-open") ? hide() : show()
        }
      >
        <Icon name="info" size={13} />
      </button>
      <div
        ref={popup}
        id={id}
        role="tooltip"
        popover="manual"
        className="collateral-popover"
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={leave}
      >
        <dl>
          {(
            [
              ["HyperEVM", breakdown?.evm],
              ["HyperCore", breakdown?.core],
            ] as const
          ).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value === undefined ? "—" : formatAmount(value)} USDC</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
