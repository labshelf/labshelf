/** Pins that host and origin reads of a URL string never throw and give the empty answer for input that is no URL. */
import { hostOf, originOf, parseUrl } from "../../src/url/index";

describe("hostOf", () => {
  it("gives the lower-case host name without port or www stripping", () => {
    expect(hostOf("https://www.example.com:8080/x")).toBe("www.example.com");
    expect(hostOf("HTTPS://EXAMPLE.com")).toBe("example.com");
  });

  it("gives an empty string for input that is not a URL", () => {
    expect(hostOf("not a url")).toBe("");
    expect(hostOf("")).toBe("");
  });
});

describe("parseUrl", () => {
  it("gives undefined for invalid input and a URL for valid input", () => {
    expect(parseUrl("not a url")).toBeUndefined();
    expect(parseUrl("https://a.b/x")?.pathname).toBe("/x");
  });
});

describe("originOf", () => {
  it("gives undefined for a missing or invalid value", () => {
    expect(originOf(undefined)).toBeUndefined();
    expect(originOf("")).toBeUndefined();
    expect(originOf("nope")).toBeUndefined();
  });

  it("gives scheme, host and port", () => {
    expect(originOf("https://a.b:81/x")).toBe("https://a.b:81");
  });
});
