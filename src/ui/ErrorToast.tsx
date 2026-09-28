import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

/** Fixed feedback keeps transaction failures out of the form's layout. */
export function ErrorToast({
  children,
  closeLabel,
}: {
  children: ReactNode;
  closeLabel: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDismissed(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (dismissed) return null;
  return (
    <div className="error-toast">
      <div>{children}</div>
      <button
        className="icon-button"
        aria-label={closeLabel}
        onClick={() => setDismissed(true)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
