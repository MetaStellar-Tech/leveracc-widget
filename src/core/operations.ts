import type { EventContext, OperationRecord } from "../types";
import { invariant } from "./errors";

export const terminal = (op?: OperationRecord) =>
  !op ||
  ["submitted", "awaitingAction", "success", "failed"].includes(op.stage);

export function operationKey(context: EventContext) {
  return `leveracc:widget:v1:${context.network}:${context.projectId.toLowerCase()}:${context.owner?.toLowerCase()}`;
}

/** Remove only obsolete widget transaction records; storage is never required. */
export function clearLegacyTransactions() {
  try {
    const keys = Object.keys(localStorage).filter(
      (key) =>
        key.startsWith("leveracc:widget:v1:") ||
        key.startsWith("leveracc:widget:gas:"),
    );
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Private browsing or denied storage must not prevent wallet interactions.
  }
}

const active = new Set<string>();
export async function withOperationLock<T>(
  context: EventContext,
  run: () => Promise<T>,
): Promise<T> {
  const key = operationKey(context);
  const execute = async () => {
    invariant(
      !active.has(key),
      "OPERATION_BUSY",
      "Another widget is using this account.",
    );
    active.add(key);
    try {
      return await run();
    } finally {
      active.delete(key);
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(key, { ifAvailable: true }, (lock) => {
      invariant(lock, "OPERATION_BUSY", "Another tab is using this account.");
      return execute();
    });
  return execute();
}
