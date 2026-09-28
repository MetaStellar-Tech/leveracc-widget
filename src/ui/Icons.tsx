import { createElement, useId, type ReactNode } from "react";
import tokenNodes from "./assets/token-nodes.json";
export type IconName =
  | "close"
  | "check"
  | "fuel"
  | "pen"
  | "wallet"
  | "copy"
  | "down"
  | "up"
  | "right"
  | "transfer"
  | "plus"
  | "repay"
  | "chevron"
  | "info";
const paths: Record<IconName, ReactNode> = {
  close: <path d="m18 6-12 12M6 6l12 12" />,
  check: <path d="m20 6-11 11-5-5" />,
  fuel: (
    <>
      <path d="M3 22V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M2 22h12M3 10h10M13 12h2a2 2 0 0 1 2 2v4a2 2 0 0 0 4 0V9l-3-3" />
      <path d="M18 8h3v3h-1a2 2 0 0 1-2-2Z" />
    </>
  ),
  pen: (
    <>
      <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />
      <path d="M12 20h8" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6M20 12h-4v5h4" />
      <path d="M16 14.5h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    </>
  ),
  down: <path d="M12 5v14m-7-7 7 7 7-7" />,
  right: <path d="M5 12h14m-7-7 7 7-7 7" />,
  up: <path d="M12 19V5m-7 7 7-7 7 7" />,
  transfer: <path d="m3 16 4 4 4-4M7 20V4m14 4-4-4-4 4m4-4v16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  repay: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4m0-4h.01" />
    </>
  ),
};
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
type Node = [string, Record<string, unknown>, Node[]?];
export function TokenIcon({
  name = "usdc",
  size = 24,
}: {
  name?: keyof typeof tokenNodes;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  const render = (nodes: Node[]): ReactNode =>
    nodes.map(([tag, props, children], key) =>
      createElement(
        tag,
        {
          ...Object.fromEntries(
            Object.entries(props).map(([k, v]) => [
              k,
              typeof v === "string"
                ? v
                    .replace(/#([\w-]+)/g, (_, value) =>
                      k === "clipPath" ? `#${id}-${value}` : `#${value}`,
                    )
                    .replace(/^([\w-]+)$/, (value) =>
                      k === "id" ? `${id}-${value}` : value,
                    )
                : v,
            ]),
          ),
          key,
        },
        children ? render(children) : undefined,
      ),
    );
  return (
    <svg
      aria-hidden="true"
      className="token-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
    >
      {render(tokenNodes[name] as Node[])}
    </svg>
  );
}
