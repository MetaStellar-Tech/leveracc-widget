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
  CCTP_TESTNET,
  cctpRoute,
  depositArgs,
  forwardHook,
  operationKey,
  validateMessage,
  type CctpOperation,
} from "../src/bridge/cctp";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const op: CctpOperation = {
  route: "arbitrum",
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
  n(19, 4),
  n(3, 4),
  nonce,
  word(CCTP.messenger),
  word(CCTP.messenger),
  word(zeroAddress),
  n(2000, 4),
  n(2000, 4),
  n(1, 4),
  word(CCTP.evmUsdc),
  word(owner),
  n(10000000),
  word(owner),
  n(200000),
  n(200000),
  n(999999),
  forwardHook(owner, "arbitrum"),
]);
const replace = (raw: Hex, offset: number, data: Hex): Hex =>
  concatHex([
    sliceHex(raw, 0, offset),
    data,
    sliceHex(raw, offset + (data.length - 2) / 2),
  ]);

describe("Arbitrum withdrawal CCTP encoding and message validation", () => {
  it("binds direct burns to the LA sender while keeping owner as recipient", async () => {
    const direct: CctpOperation = { ...op, sourceAccount: other };
    const raw = replace(message, 248, word(other));
    expect(() => validateMessage(message, direct)).toThrow();
    expect(() => validateMessage(raw, op)).toThrow();
    expect(validateMessage(raw, direct).net).toBe(net);
  });
  it("isolates testnet routes, burn tokens, storage and message validation", () => {
    expect(cctpRoute("arbitrum", "testnet")).toMatchObject({
      sourceChainId: 998,
      destinationChainId: 421614,
      sourceDomain: 19,
      destinationDomain: 3,
      messenger: CCTP_TESTNET.messenger,
    });
    expect(
      depositArgs(10000000n, 200000n, owner, "arbitrum", "testnet")[3],
    ).toBe(CCTP_TESTNET.evmUsdc);
    const raw = replace(
      replace(
        replace(message, 44, word(CCTP_TESTNET.messenger)),
        76,
        word(CCTP_TESTNET.messenger),
      ),
      152,
      word(CCTP_TESTNET.evmUsdc),
    );
    expect(validateMessage(raw, { ...op, network: "testnet" }).net).toBe(net);
    expect(() => validateMessage(raw, op)).toThrow();
    expect(() =>
      validateMessage(message, { ...op, network: "testnet" }),
    ).toThrow();
    expect(operationKey(owner, owner, "arbitrum", "testnet")).toContain(
      ":998:421614:",
    );
    expect(operationKey(owner, owner, "arbitrum", "testnet")).not.toBe(
      operationKey(owner, owner, "arbitrum"),
    );
  });
  it("uses an EOA recipient and plain EVM hook with separate storage", () => {
    const args = depositArgs(
      BigInt(op.amount),
      BigInt(op.maxFee),
      owner,
      "arbitrum",
    );
    expect(args[1]).toBe(3);
    expect(args[3]).toBe(CCTP.evmUsdc);
    expect(args[6]).toBe(2000);
    expect(args[2]).toBe(word(owner));
    expect(args[4]).toBe(word(zeroAddress));
    expect(args[7].length).toBe(66);
    expect(operationKey(owner, owner, "arbitrum")).not.toBe(
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
