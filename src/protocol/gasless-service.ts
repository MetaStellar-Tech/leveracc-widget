import type { ResolvedConfig } from "../core/config";
import { GaslessError } from "./gasless-validation";

export interface GaslessConfig {
  gasless?: {
    enabled: boolean;
    source_chain_id: number;
    min_sell_amount_raw: string;
    max_sell_amount_raw: string;
  };
}
export class GaslessServiceError extends Error {
  constructor(
    public status: number,
    public retryAfterMs = 0,
    public requestSent = true,
  ) {
    super("serviceError");
  }
}
const cooldowns = new Map<string, number>();
export async function gaslessRequest<T>(
  config: ResolvedConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const until = cooldowns.get(config.protocolServiceUrl) ?? 0;
  if (until > Date.now())
    throw new GaslessServiceError(429, until - Date.now(), false);
  const response = await fetch(`${config.protocolServiceUrl}${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    const delay = retry
      ? /^\d+$/.test(retry)
        ? Number(retry) * 1000
        : Date.parse(retry) - Date.now()
      : 0;
    const retryAfterMs = Math.max(5000, Number.isFinite(delay) ? delay : 0);
    if ([429, 503].includes(response.status))
      cooldowns.set(config.protocolServiceUrl, Date.now() + retryAfterMs);
    throw new GaslessServiceError(response.status, retryAfterMs);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object")
    throw new GaslessError("serviceError");
  return payload.data ?? payload;
}
export const getGaslessConfig = (config: ResolvedConfig) =>
  gaslessRequest<GaslessConfig>(config, "/api/v1/gas-top-ups/config");
