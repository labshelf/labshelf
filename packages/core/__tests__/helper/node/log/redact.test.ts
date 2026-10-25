import { removeSecretsFromText, removeSecretsFromJson } from "../../../../src/helper/node/log/index";

describe("removeSecretsFromText", () => {
  it("hides registered secrets", () => {
    expect(removeSecretsFromText("token abc123 sent", ["abc123"])).toBe("token [redacted] sent");
  });

  it("hides bearer tokens", () => {
    expect(removeSecretsFromText("Authorization: Bearer x.y-z", [])).toBe("Authorization: Bearer [redacted]");
  });

  it("hides key query parameters", () => {
    expect(removeSecretsFromText("GET https://a/b?x=1&key=abc&y=2", [])).toBe("GET https://a/b?x=1&key=[redacted]&y=2");
    expect(removeSecretsFromText("https://a/b?key=abc", [])).toBe("https://a/b?key=[redacted]");
  });

  it("hides URL fragments", () => {
    expect(removeSecretsFromText("open https://a/b#frag now", [])).toBe("open https://a/b#[redacted] now");
  });
});

describe("removeSecretsFromJson", () => {
  it("reaches strings nested in objects and arrays", () => {
    expect(removeSecretsFromJson({ a: ["Bearer q", { b: "s3" }], n: 1 }, ["s3"])).toEqual({ a: ["Bearer [redacted]", { b: "[redacted]" }], n: 1 });
  });
});
