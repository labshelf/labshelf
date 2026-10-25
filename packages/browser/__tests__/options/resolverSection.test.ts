/**
 * The options page flags a custom resolver template that cannot be used, and saves only rows whose template is valid.
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { RESOLVER_TEMPLATE_ERROR, checkResolverTemplate, listWritableResolvers } from "../../src/options/resolverSection";

describe("checkResolverTemplate", () => {
  it("accepts an http(s) address with {doi} and says nothing for an empty field", () => {
    expect(checkResolverTemplate("https://host.example/find/{doi}")).toBeUndefined();
    expect(checkResolverTemplate("  ")).toBeUndefined();
  });

  it("reports an error for text without {doi} or without an http(s) scheme", () => {
    expect(checkResolverTemplate("https://host.example/find")).toBe(RESOLVER_TEMPLATE_ERROR);
    expect(checkResolverTemplate("host.example/{doi}")).toBe(RESOLVER_TEMPLATE_ERROR);
  });
});

describe("listWritableResolvers", () => {
  it("drops invalid rows, keeps the order and trims the fields", () => {
    expect(listWritableResolvers([
      { name: " A ", template: " https://a.example/{doi} ", enabled: true },
      { name: "bad", template: "nope", enabled: true },
      { name: "", template: "https://b.example/?q={doi}", enabled: false },
    ])).toEqual([
      { name: "A", template: "https://a.example/{doi}", enabled: true },
      { name: "https://b.example/?q={doi}", template: "https://b.example/?q={doi}", enabled: false },
    ]);
  });
});
