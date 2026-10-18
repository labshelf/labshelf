import { redactText, redactValue } from "../../../../../src/writing/helper/node/log/index";

describe("redactText", () => {
  it("hides registered secrets", () => {
    expect(redactText("token abc123 sent", ["abc123"])).toBe("token [redacted] sent");
  });

  it("hides bearer tokens", () => {
    expect(redactText("Authorization: Bearer x.y-z", [])).toBe("Authorization: Bearer [redacted]");
  });

  it("hides key query parameters", () => {
    expect(redactText("GET https://a/b?x=1&key=abc&y=2", [])).toBe("GET https://a/b?x=1&key=[redacted]&y=2");
    expect(redactText("https://a/b?key=abc", [])).toBe("https://a/b?key=[redacted]");
  });

  it("hides URL fragments", () => {
    expect(redactText("open https://a/b#frag now", [])).toBe("open https://a/b#[redacted] now");
  });
});

describe("redactValue", () => {
  it("reaches strings nested in objects and arrays", () => {
    expect(redactValue({ a: ["Bearer q", { b: "s3" }], n: 1 }, ["s3"])).toEqual({ a: ["Bearer [redacted]", { b: "[redacted]" }], n: 1 });
  });
});
