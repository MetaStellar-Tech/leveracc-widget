import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export function CopyAddressButton({
  address,
  copyLabel,
  copiedLabel,
  onError,
}: {
  address?: string;
  copyLabel: string;
  copiedLabel: string;
  onError: (error: unknown) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attempt = useRef(0);
  useEffect(() => {
    setCopied(false);
    return () => {
      attempt.current++;
      clearTimeout(timer.current);
    };
  }, [address]);
  async function copy() {
    if (!address) return;
    const request = ++attempt.current;
    clearTimeout(timer.current);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(address);
      if (request !== attempt.current) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      if (request === attempt.current) onError(error);
    }
  }
  return (
    <button
      type="button"
      className="account-copy"
      disabled={!address}
      aria-label={copied ? copiedLabel : copyLabel}
      title={copied ? copiedLabel : copyLabel}
      onClick={() => void copy()}
    >
      <Icon name={copied ? "check" : "copy"} size={16} />
    </button>
  );
}
