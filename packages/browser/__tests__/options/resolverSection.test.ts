/**
 * The options page's editable lists: a proxy template shows its kind or an error, a resolver template is flagged when unusable,
 * and each list saves only rows whose template is valid.
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { PROXY_TEMPLATE_ERROR, RESOLVER_TEMPLATE_ERROR, checkResolverTemplate, checkTemplate, listWritableProxies, listWritableResolvers } from "../../src/options/resolverSection";

describe("checkTemplate", () => {
  it("names the kind of each valid shape", () => {
    expect(checkTemplate("https://login.ezproxy.uni.edu/login?url=$@")).toEqual({ kind: "prefix", label: "Prefix" });
    expect(checkTemplate(".ezproxy.uni.edu")).toEqual({ kind: "hostname", label: "Hostname" });
    expect(checkTemplate("https://go.openathens.net/redirector/uni.edu")).toEqual({ kind: "openathens", label: "OpenAthens" });
  });

  it("reports an error for text that is none of them and nothing for an empty field", () => {
    expect(checkTemplate("https://login.ezproxy.uni.edu/login")).toEqual({ error: PROXY_TEMPLATE_ERROR });
    expect(checkTemplate("  ")).toBeUndefined();
  });
});

describe("listWritableProxies", () => {
  it("drops invalid rows, keeps the order and trims the fields", () => {
    expect(listWritableProxies([
      { name: " A ", template: " .ezproxy.a.edu ", enabled: true },
      { name: "bad", template: "nope", enabled: true },
      { name: "", template: "https://p.example/login?url=$@", enabled: false },
    ])).toEqual([
      { name: "A", template: ".ezproxy.a.edu", enabled: true },
      { name: "https://p.example/login?url=$@", template: "https://p.example/login?url=$@", enabled: false },
    ]);
  });
});

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
