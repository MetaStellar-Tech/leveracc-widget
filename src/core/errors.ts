export class WidgetError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "WidgetError";
  }
}
export function invariant(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new WidgetError(code, message);
}
export function normalizeError(error: unknown): WidgetError {
  if (error instanceof WidgetError) return error;
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  for (let i = 0; pending.length && i < 64; i++) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || visited.has(current))
      continue;
    visited.add(current);
    const e = current as Record<string, unknown>;
    if (
      e.code === 4001 ||
      e.code === "4001" ||
      e.code === "ACTION_REJECTED" ||
      e.name === "UserRejectedRequestError"
    )
      return new WidgetError(
        "USER_REJECTED",
        "Request declined in wallet. You can try again.",
      );
    pending.push(e.cause, e.error, e.originalError, e.data, e.info);
  }
  return new WidgetError(
    "REQUEST_FAILED",
    error instanceof Error
      ? ("shortMessage" in error && typeof error.shortMessage === "string"
          ? error.shortMessage
          : error.message
        ).slice(0, 500)
      : "Request failed. Refresh and try again.",
  );
}
