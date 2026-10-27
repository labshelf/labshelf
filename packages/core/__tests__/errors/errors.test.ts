import { describeError, errorCode, formatError, isAbortError, toError } from "../../src/errors/index";

describe("formatError", () => {
  it("takes the message of an Error and the text of anything else", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError("plain")).toBe("plain");
    expect(formatError(404)).toBe("404");
    expect(formatError(null)).toBe("null");
  });
});

describe("describeError", () => {
  it("returns the message and stack of an Error", () => {
    const error = new Error("boom");
    expect(describeError(error)).toEqual({ message: "boom", stack: error.stack });
  });

  it("stringifies non-errors without inventing a stack", () => {
    expect(describeError("plain")).toEqual({ message: "plain" });
    expect(describeError({ code: 7 })).toEqual({ message: "[object Object]" });
    expect(describeError(undefined)).toEqual({ message: "undefined" });
  });
});

describe("toError", () => {
  it("keeps an Error as it is and wraps anything else", () => {
    const error = new Error("boom");
    expect(toError(error)).toBe(error);
    expect(toError("plain")).toBeInstanceOf(Error);
    expect(toError("plain").message).toBe("plain");
  });
});

describe("errorCode", () => {
  it("reads a string code and gives undefined for anything else", () => {
    expect(errorCode({ code: "ENOENT" })).toBe("ENOENT");
    expect(errorCode(Object.assign(new Error("x"), { code: "EEXIST" }))).toBe("EEXIST");
    expect(errorCode({ code: 2 })).toBeUndefined();
    expect(errorCode("x")).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe("isAbortError", () => {
  it("is true for an object named AbortError", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("is false for other errors and non-objects", () => {
    expect(isAbortError(new Error("x"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
