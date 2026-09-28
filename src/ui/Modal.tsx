import { Icon, TokenIcon } from "./Icons";
import {
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { styles } from "./styles";
import { colorStyles } from "./colors";
import type { WidgetColors } from "../types";
/** A page-level shadow isolates the overlay from clipped or transformed hosts.
 * Keep the dialog mounted while host wallet prompts take focus above it. */
export function Modal({
  colors,
  theme,
  locale,
  title,
  description,
  busy,
  onClose,
  closeLabel,
  closeBusyLabel,
  children,
  variant = "default",
  walletPrompt = false,
}: {
  colors: WidgetColors;
  theme: string;
  locale: string;
  title: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  closeLabel: string;
  closeBusyLabel?: string;
  children: ReactNode;
  variant?:
    | "default"
    | "create"
    | "borrow"
    | "repay"
    | "deposit"
    | "transfer"
    | "withdraw";
  walletPrompt?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [root, setRoot] = useState<ShadowRoot>(),
    id = useId();
  const current = useRef({ busy, walletPrompt, onClose });
  current.current = { busy, walletPrompt, onClose };
  useLayoutEffect(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement;
    const trigger = active as HTMLElement | null;
    const triggerRoot = trigger?.getRootNode() as
      Document | ShadowRoot | undefined;
    const triggerKey = trigger?.dataset.modalTrigger;
    const host = document.createElement("div");
    host.dataset.leveraccOverlay = "";
    document.body.append(host);
    setRoot(host.attachShadow({ mode: "open" }));
    return () => {
      host.remove();
      queueMicrotask(() => {
        const target = trigger?.isConnected
          ? trigger
          : triggerKey
            ? triggerRoot?.querySelector<HTMLElement>(
                `[data-modal-trigger="${triggerKey}"]`,
              )
            : undefined;
        target?.focus();
      });
    };
  }, []);
  useLayoutEffect(() => {
    if (!root) return;
    const dialog = ref.current!;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ).filter(
        (element) => !element.hidden && element.getClientRects().length > 0,
      );
    const focusFirst = () => (focusable()[0] ?? dialog).focus();
    focusFirst();
    const onKeyDown = (event: KeyboardEvent) => {
      if (current.current.walletPrompt || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!current.current.busy) current.current.onClose();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0] ?? dialog;
        const last = items.at(-1) ?? dialog;
        const active = root.activeElement;
        if (
          !dialog.contains(active) ||
          (event.shiftKey ? active === first : active === last) ||
          active === dialog
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (
        !current.current.walletPrompt &&
        !event.composedPath().includes(dialog)
      )
        focusFirst();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [root]);
  useLayoutEffect(() => {
    if (root && !walletPrompt && !ref.current?.contains(root.activeElement))
      ref.current?.focus();
  }, [root, walletPrompt]);
  if (!root) return null;
  return createPortal(
    <>
      <style>{styles}</style>
      <div
        className={`modal-layer ${theme}`}
        lang={locale}
        style={colorStyles(colors)}
      >
        <div
          className="modal-backdrop"
          aria-hidden="true"
          onClick={() => {
            if (!busy) onClose();
          }}
        />
        <dialog
          open
          tabIndex={-1}
          ref={ref}
          className={`modal ${variant} ${walletPrompt ? "wallet-prompt" : ""}`}
          aria-modal={!walletPrompt}
          aria-labelledby={id}
          aria-describedby={description ? `${id}-description` : undefined}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) onClose();
          }}
        >
          <header className="modal-header">
            {(variant === "transfer" || variant === "withdraw") && (
              <div className="modal-emblem">
                {variant === "withdraw" ? (
                  <TokenIcon size={40} />
                ) : (
                  <Icon name="transfer" size={32} />
                )}
              </div>
            )}
            <h2 id={id}>{title}</h2>
            <button
              className="icon-button close"
              aria-label={closeLabel}
              title={busy ? closeBusyLabel : undefined}
              disabled={busy}
              onClick={onClose}
            >
              <Icon name="close" size={variant === "borrow" ? 20 : 16} />
            </button>
            {description && <p id={`${id}-description`}>{description}</p>}
          </header>
          {children}
        </dialog>
      </div>
    </>,
    root,
  );
}
