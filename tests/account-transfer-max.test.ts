import { describe, expect, it } from "vitest";
import { accountTransferMax } from "../src/core/amount";

describe("Account Transfer MAX headroom", () => {
  it.each([
    [0n, 0n],
    [1n, 0n],
    [5000n, 0n],
    [5001n, 1n],
    [1000000n, 995000n],
    [5000000n, 4995000n],
    [5000001n, 4995000n],
    [12000000n, 11988000n],
    [42558294n, 42515735n],
  ])("reserves a rounded-up buffer for %s", (maximum, expected) => {
    expect(accountTransferMax(maximum)).toBe(expected);
  });
});
