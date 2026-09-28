import { describe, expect, it } from "vitest";
import { concatHex, padHex, sliceHex, toHex, type Address } from "viem";
import {
  CCTP,
  amountUnits,
  depositArgs,
  forwardHook,
  operationKey,
  operationSchema,
  quoteFee,
  cctpFeeLimit,
  validateMessage,
  type CctpOperation,
} from "../src/bridge/cctp";

describe("Fund fee ceiling", () => {
  it.each([
    [0, 0],
    [1, 2],
    [10, 11],
    [11, 13],
    [201400, 221540],
  ])("buffers %s to %s with upward rounding", (fee, expected) => {
    expect(cctpFeeLimit(BigInt(fee))).toBe(BigInt(expected));
  });
  it("rejects negative estimates", () => {
    expect(() => cctpFeeLimit(BigInt(-1))).toThrow("Invalid fee");
  });
});

const owner: Address = "0x1111111111111111111111111111111111111111";
const recipient: Address = "0x2222222222222222222222222222222222222222";
export const testOperation: CctpOperation = {
  owner,
  recipient,
  hash: `0x${"ab".repeat(32)}`,
  amount: "10000000",
  maxFee: "200000",
  baseline: "500000000",
  createdAt: 1000,
};
export function testMessage(op = testOperation) {
  const word = (address: Address) => padHex(address, { size: 32 });
  const n = (value: number | bigint, size: number) => toHex(value, { size });
  return concatHex([
    n(1, 4),
    n(3, 4),
    n(19, 4),
    n(123, 32),
    word(CCTP.messenger),
    word(CCTP.messenger),
    word(CCTP.forwarder),
    n(1000, 4),
    n(1000, 4),
    n(1, 4),
    word(CCTP.usdc),
    word(CCTP.forwarder),
    n(BigInt(op.amount), 32),
    word(op.owner),
    n(BigInt(op.maxFee), 32),
    n(200000, 32),
    n(999999, 32),
    forwardHook(op.recipient),
  ]);
}

describe("CCTP deposit encoding", () => {
  it("separates source EOA, LA recipient and forwarder", () => {
    const args = depositArgs(BigInt(10000000), BigInt(200000), recipient);
    expect(args[2].toLowerCase()).toBe(
      padHex(CCTP.forwarder, { size: 32 }).toLowerCase(),
    );
    expect(args[4]).toBe(args[2]);
    expect(args[7].length).toBe(114);
    expect(sliceHex(args[7], 28, 32)).toBe("0x00000018");
    expect(sliceHex(args[7], 32, 52)).toBe(recipient);
    expect(sliceHex(args[7], 52)).toBe("0xffffffff");
  });
  it("rejects zero recipients and deposits that cannot cover fees", () => {
    expect(() => forwardHook(`0x${"0".repeat(40)}`)).toThrow();
    expect(() =>
      depositArgs(BigInt(200000), BigInt(200000), recipient),
    ).toThrow();
  });
  it("preserves USDC6 precision and rejects ambiguous amounts", () => {
    expect(amountUnits("1234567890.123456")).toBe(BigInt("1234567890123456"));
    for (const bad of ["1e6", "-1", "1.0000001", "", "NaN", "1,000"])
      expect(amountUnits(bad)).toBeNull();
  });
  it("quotes forwarding plus protocol basis points with upward rounding", () => {
    const quote = [
      { finalityThreshold: 1000, minimumFee: 0, forwardFee: { high: 200000 } },
    ];
    expect(quoteFee(quote, BigInt(10000000))).toBe(BigInt(200000));
    expect(quoteFee([{ ...quote[0], minimumFee: 1.4 }], BigInt(10000000))).toBe(
      BigInt(201400),
    );
    expect(quoteFee([{ ...quote[0], minimumFee: 1.4 }], BigInt(1))).toBe(
      BigInt(200001),
    );
    expect(() =>
      quoteFee([{ ...quote[0], minimumFee: -1 }], BigInt(1)),
    ).toThrow();
    expect(() => quoteFee([], BigInt(1))).toThrow();
  });
});

describe("CCTP confirmation boundaries", () => {
  it("validates the attested message and actual net amount", () => {
    expect(validateMessage(testMessage(), testOperation).net).toBe(
      BigInt(9800000),
    );
  });
  it.each([4, 8, 44, 76, 108, 152, 184, 216, 248, 280, 312, 408, 428])(
    "rejects altered field at byte %s",
    (offset) => {
      const raw = testMessage();
      const byte = raw.slice(2 + offset * 2, 4 + offset * 2);
      const altered = `${raw.slice(0, 2 + offset * 2)}${byte === "ff" ? "00" : "ff"}${raw.slice(4 + offset * 2)}`;
      expect(() => validateMessage(altered, testOperation)).toThrow();
    },
  );
  it("does not let same-address sample hooks redirect an LA deposit", () => {
    expect(() =>
      validateMessage(
        testMessage({ ...testOperation, recipient: owner }),
        testOperation,
      ),
    ).toThrow();
  });
  it("scopes restored operations by chain and both identities", () => {
    expect(operationKey(owner, recipient)).not.toBe(
      operationKey(recipient, owner),
    );
    expect(operationSchema.parse(testOperation)).toEqual(testOperation);
    expect(() =>
      operationSchema.parse({ ...testOperation, hash: "bad" }),
    ).toThrow();
  });
});
