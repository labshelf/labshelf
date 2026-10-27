/** Pins the unknown-narrowing predicates shared by the message and file parsers. */
import {
  isBoolean,
  isCount,
  isNonBlankString,
  isNonEmptyString,
  isNonEmptyStringList,
  isNumber,
  isOneOf,
  isOptional,
  isRecord,
  isString,
  isStringArray,
  isStringUpTo,
  isTimestamp,
} from "../../src/guards/index";

describe("isRecord", () => {
  it("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("rejects arrays, null and non-objects", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{}])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});

describe("isString and isNonEmptyString", () => {
  it("isString accepts any string, including the empty one", () => {
    expect(isString("")).toBe(true);
    expect(isString("a")).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isString(undefined)).toBe(false);
  });

  it("isNonEmptyString rejects the empty string and non-strings", () => {
    expect(isNonEmptyString("a")).toBe(true);
    expect(isNonEmptyString(" ")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
  });
});

describe("isBoolean", () => {
  it("accepts only true and false", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean("true")).toBe(false);
  });
});

describe("isOptional", () => {
  it("accepts undefined and values the check accepts", () => {
    expect(isOptional(undefined, isString)).toBe(true);
    expect(isOptional("a", isString)).toBe(true);
    expect(isOptional(1, isString)).toBe(false);
    expect(isOptional(null, isString)).toBe(false);
  });
});

describe("isNonEmptyStringList", () => {
  it("accepts arrays whose every entry is a non-empty string", () => {
    expect(isNonEmptyStringList([])).toBe(true);
    expect(isNonEmptyStringList(["a", "b"])).toBe(true);
    expect(isNonEmptyStringList(["a", ""])).toBe(false);
    expect(isNonEmptyStringList(["a", 1])).toBe(false);
    expect(isNonEmptyStringList("a")).toBe(false);
  });
});

describe("isNonBlankString", () => {
  it("rejects whitespace-only strings that isNonEmptyString accepts", () => {
    expect(isNonBlankString("  \t")).toBe(false);
    expect(isNonEmptyString("  \t")).toBe(true);
    expect(isNonBlankString("")).toBe(false);
    expect(isNonBlankString(" a ")).toBe(true);
    expect(isNonBlankString(1)).toBe(false);
  });
});

describe("isStringUpTo", () => {
  it("accepts strings up to the limit, the empty string included", () => {
    const isShort = isStringUpTo(3);
    expect(isShort("abc")).toBe(true);
    expect(isShort("")).toBe(true);
    expect(isShort("abcd")).toBe(false);
    expect(isShort(12)).toBe(false);
  });
});

describe("isNumber", () => {
  it("accepts finite numbers only", () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(-1.5)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNumber("1")).toBe(false);
  });
});

describe("isCount", () => {
  it("accepts integers from zero up", () => {
    expect(isCount(0)).toBe(true);
    expect(isCount(7)).toBe(true);
    expect(isCount(-1)).toBe(false);
    expect(isCount(1.5)).toBe(false);
    expect(isCount(Number.NaN)).toBe(false);
    expect(isCount("1")).toBe(false);
  });
});

describe("isStringArray", () => {
  it("accepts arrays of strings, empty strings included", () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(["a", ""])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray("a")).toBe(false);
  });
});

describe("isTimestamp", () => {
  it("accepts strings Date.parse understands", () => {
    expect(isTimestamp("2026-01-02T03:04:05.000Z")).toBe(true);
    expect(isTimestamp("not a date")).toBe(false);
    expect(isTimestamp("")).toBe(false);
    expect(isTimestamp(1700000000000)).toBe(false);
  });
});

describe("isOneOf", () => {
  it("accepts only members of the list, list first", () => {
    const modes = ["a", "b"] as const;
    expect(isOneOf(modes, "a")).toBe(true);
    expect(isOneOf(modes, "c")).toBe(false);
    expect(isOneOf(modes, 1)).toBe(false);
  });
});
