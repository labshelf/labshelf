/** Pins that parseJsonObject gives the root object of JSON text and undefined for anything else. */
import { parseJsonObject } from "../../src/json/index";

describe("parseJsonObject", () => {
  it("gives the root object", () => {
    expect(parseJsonObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
    expect(parseJsonObject("{}")).toEqual({});
  });

  it("keeps nested objects and arrays inside the root", () => {
    expect(parseJsonObject('{"a":{"b":[1,{"c":null}]}}')).toEqual({ a: { b: [1, { c: null }] } });
  });

  it("gives undefined for text that is not valid JSON", () => {
    expect(parseJsonObject("{")).toBeUndefined();
    expect(parseJsonObject("")).toBeUndefined();
    expect(parseJsonObject("not json")).toBeUndefined();
  });

  it("gives undefined for a null root", () => {
    expect(parseJsonObject("null")).toBeUndefined();
  });

  it("gives undefined for an array root", () => {
    expect(parseJsonObject("[]")).toBeUndefined();
    expect(parseJsonObject('[{"a":1}]')).toBeUndefined();
  });

  it("gives undefined for a primitive root", () => {
    expect(parseJsonObject("1")).toBeUndefined();
    expect(parseJsonObject('"x"')).toBeUndefined();
    expect(parseJsonObject("true")).toBeUndefined();
  });
});
