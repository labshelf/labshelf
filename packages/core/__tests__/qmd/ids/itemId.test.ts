import { isItemId, itemIdGenerator, newItemId } from "../../../src/qmd/ids/index";

const zeros = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0);
const ones = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0xff);

describe("itemId", () => {
  it("writes n- plus a ULID whose time part encodes the clock", () => {
    const id = itemIdGenerator(() => 1469918176385, zeros)();
    expect(id).toBe("n-01ARYZ6S410000000000000000");
    expect(isItemId(id)).toBe(true);
  });

  it("creates valid ids by default", () => {
    expect(isItemId(newItemId())).toBe(true);
  });

  it("increases within one millisecond and sorts by time", () => {
    let time = 1_700_000_000_000;
    const next = itemIdGenerator(() => time, (bytes) => bytes.fill(0x7f));
    const sameMs = [next(), next(), next()];
    time += 1;
    const later = next();
    expect([...sameMs, later]).toEqual([...sameMs, later].sort());
    expect(new Set([...sameMs, later]).size).toBe(4);
    expect(sameMs[1]!.slice(0, 12)).toBe(sameMs[0]!.slice(0, 12));
  });

  it("carries into higher digits and fails on overflow", () => {
    const next = itemIdGenerator(() => 5, ones);
    expect(next().endsWith("ZZZZZZZZZZZZZZZZ")).toBe(true);
    expect(() => next()).toThrow(/overflowed/);
    const carry = itemIdGenerator(() => 5, (bytes) => { bytes.fill(0); bytes[9] = 0x1f; return bytes; });
    expect(carry().slice(-2)).toBe("0Z");
    expect(carry().slice(-2)).toBe("10");
  });

  it("rejects clocks outside 48 bits", () => {
    expect(() => itemIdGenerator(() => -1, zeros)()).toThrow(/clock/);
    expect(() => itemIdGenerator(() => 2 ** 48, zeros)()).toThrow(/clock/);
  });

  it("recognises only n- plus a ULID", () => {
    expect(isItemId("n-01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(true);
    expect(isItemId("01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(false);
    expect(isItemId("n-01ARYZ6S41TSV4RRFFQ69G5FA")).toBe(false);
    expect(isItemId("n-01ARYZ6S41TSV4RRFFQ69G5FAI")).toBe(false);
    expect(isItemId("n-81ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(false);
  });
});
