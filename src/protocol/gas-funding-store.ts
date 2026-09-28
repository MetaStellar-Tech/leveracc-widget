import type { Address } from "viem";
import type { ResolvedConfig } from "../core/config";
import { invariant } from "../core/errors";

export function gasFundingKey(config: ResolvedConfig, owner: Address) {
  return `leveracc:widget:gas:${config.network}:${encodeURIComponent(config.protocolServiceUrl)}:${owner.toLowerCase()}`;
}
const active = new Set<string>();
export async function withGasFundingLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const execute = async () => {
    invariant(
      !active.has(key),
      "OPERATION_BUSY",
      "Gas funding is already in progress.",
    );
    active.add(key);
    try {
      return await work();
    } finally {
      active.delete(key);
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(key, { ifAvailable: true }, (lock) => {
      invariant(
        lock,
        "OPERATION_BUSY",
        "Another tab is funding gas for this wallet.",
      );
      return execute();
    });
  return execute();
}
