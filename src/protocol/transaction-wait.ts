import { WidgetError } from "../core/errors";
import type { ProtocolPort } from "./port";

/** Bound read latency too; a timed-out read can never authorize a later write. */
export async function boundedRead<T>(
  read: () => Promise<T>,
  milliseconds: number,
): Promise<T> {
  if (milliseconds <= 0)
    throw new WidgetError(
      "TRANSACTION_WAIT_TIMEOUT",
      "Transaction confirmation or arrival is still pending. Check again without resubmitting.",
    );
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new WidgetError(
            "TRANSACTION_WAIT_TIMEOUT",
            "Transaction confirmation or arrival is still pending. Check again without resubmitting.",
          ),
        ),
      Math.max(0, milliseconds),
    );
  });
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function waitUntil(
  port: ProtocolPort,
  ready: () => Promise<boolean>,
  deadline: number,
) {
  while (true) {
    await boundedRead(async () => {
      await port.checkContext?.();
    }, deadline - Date.now());
    if (await boundedRead(ready, deadline - Date.now())) return;
    if (Date.now() >= deadline)
      throw new WidgetError(
        "TRANSACTION_WAIT_TIMEOUT",
        "Transaction confirmation or arrival is still pending. Check again without resubmitting.",
      );
    await boundedRead(() => port.pause!(2000), deadline - Date.now());
  }
}
