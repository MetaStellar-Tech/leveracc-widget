import { describe, expect, it } from "vitest";
import {
  concatHex,
  padHex,
  sliceHex,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import {
  CCTP,
  depositArgs,
  forwardHook,
  operationKey,
  validateMessage,
  type CctpOperation,
} from "../src/bridge/cctp";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const op: CctpOperation = {
  route: "fund",
  owner,
  recipient: owner,
  hash: `0x${"ab".repeat(32)}`,
  amount: "10000000",
  maxFee: "200000",
  baseline: "0",
  createdAt: 1000,
};
const nonce = toHex(123, { size: 32 });
const net = BigInt(9800000);
const n = (value: number | bigint, size = 32) => toHex(value, { size });
const word = (value: Hex) => padHex(value, { size: 32 });
const message = concatHex([
  n(1, 4),
  n(3, 4),
  n(19, 4),
  nonce,
  word(CCTP.messenger),
  word(CCTP.messenger),
  word(zeroAddress),
  n(1000, 4),
  n(1000, 4),
  n(1, 4),
  word(CCTP.usdc),
  word(owner),
  n(10000000),
  word(owner),
  n(200000),
  n(200000),
  n(999999),
  forwardHook(owner, "fund"),
]);
const replace = (raw: Hex, offset: number, data: Hex): Hex =>
  concatHex([
    sliceHex(raw, 0, offset),
    data,
    sliceHex(raw, offset + (data.length - 2) / 2),
  ]);

describe("Fund CCTP encoding and message validation", () => {
  it("uses an EOA recipient and plain EVM hook with separate storage", () => {
    const args = depositArgs(
      BigInt(op.amount),
      BigInt(op.maxFee),
      owner,
      "fund",
    );
    expect(args[2]).toBe(word(owner));
    expect(args[4]).toBe(word(zeroAddress));
    expect(args[7].length).toBe(66);
    expect(operationKey(owner, owner, "fund")).not.toBe(
      operationKey(owner, owner),
    );
  });
  it.each([4, 8, 44, 76, 108, 140, 144, 152, 184, 216, 248, 280, 312, 376])(
    "rejects altered message field %s",
    (offset) => {
      expect(() =>
        validateMessage(replace(message, offset, "0xff"), op),
      ).toThrow();
    },
  );
  it("requires the Fund recipient to equal the authenticated owner", () => {
    expect(() =>
      validateMessage(message, { ...op, recipient: other }),
    ).toThrow();
  });
});
