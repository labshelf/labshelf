/** The options page flags a custom resolver template that cannot be used, and saves only rows whose template is valid. */
import { RESOLVER_TEMPLATE_ERROR, judgeResolverTemplate, savableResolvers } from "../../../src/options/customResolvers/resolverRows";

describe("judgeResolverTemplate", () => {
  it("accepts an http(s) address with {doi} and says nothing for an empty field", () => {
    expect(judgeResolverTemplate("https://host.example/find/{doi}")).toBeUndefined();
    expect(judgeResolverTemplate("  ")).toBeUndefined();
  });

  it("reports an error for text without {doi} or without an http(s) scheme", () => {
    expect(judgeResolverTemplate("https://host.example/find")).toBe(RESOLVER_TEMPLATE_ERROR);
    expect(judgeResolverTemplate("host.example/{doi}")).toBe(RESOLVER_TEMPLATE_ERROR);
  });
});

describe("savableResolvers", () => {
  it("drops invalid rows, keeps the order and trims the fields", () => {
    expect(savableResolvers([
      { name: " A ", template: " https://a.example/{doi} ", enabled: true },
      { name: "bad", template: "nope", enabled: true },
      { name: "", template: "https://b.example/?q={doi}", enabled: false },
    ])).toEqual([
      { name: "A", template: "https://a.example/{doi}", enabled: true },
      { name: "https://b.example/?q={doi}", template: "https://b.example/?q={doi}", enabled: false },
    ]);
  });
});
