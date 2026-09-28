import type { Network } from "../types";
import { cctpRoute, type CctpRoute } from "./cctp";

export class CircleApiError extends Error {
  constructor(
    public status: number,
    public retryAfterMs = 0,
  ) {
    super(`Circle request failed (${status})`);
  }
}

export function circleUrl(
  tx?: string,
  route: CctpRoute = "core",
  network: Network = "mainnet",
) {
  if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx))
    throw new Error("Invalid transaction hash");
  const config = cctpRoute(route, network);
  return `https://${network === "testnet" ? "iris-api-sandbox" : "iris-api"}.circle.com${
    tx
      ? `/v2/messages/${config.sourceDomain}?transactionHash=${tx}`
      : `/v2/burn/USDC/fees/${config.sourceDomain}/${config.destinationDomain}?forward=true${route === "core" ? "&hyperCoreDeposit=true" : ""}`
  }`;
}

// Public Circle API: no credentials, proxy, or custom headers/preflight needed.
export async function circleJson(
  tx?: string,
  route: CctpRoute = "core",
  network: Network = "mainnet",
) {
  const response = await fetch(circleUrl(tx, route, network), {
    credentials: "omit",
    signal: AbortSignal.timeout(20000),
  });
  if (tx && response.status === 404) return { messages: [] };
  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    const delay =
      retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : retryAfter
          ? Date.parse(retryAfter) - Date.now()
          : 0;
    throw new CircleApiError(
      response.status,
      Number.isFinite(delay) ? Math.max(0, delay) : 0,
    );
  }
  return response.json() as Promise<unknown>;
}

export function cctpRetryDelay(attempt: number, error?: unknown) {
  return Math.min(
    60000,
    Math.max(
      2000 * 2 ** Math.min(attempt, 5),
      error instanceof CircleApiError ? error.retryAfterMs : 0,
    ),
  );
}

export function cctpRetry(attempt: number, error: unknown) {
  return (
    attempt < 2 &&
    (!(error instanceof CircleApiError) ||
      error.status === 429 ||
      error.status >= 500)
  );
}
