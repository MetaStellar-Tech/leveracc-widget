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
  let current: unknown = error;
  for (let i = 0; current && i < 8; i++) {
    const e = current as { code?: number; name?: string; cause?: unknown };
    if (e.code === 4001 || e.name === "UserRejectedRequestError")
      return new WidgetError(
        "USER_REJECTED",
        "Request declined in wallet. You can try again.",
      );
    current = e.cause;
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
