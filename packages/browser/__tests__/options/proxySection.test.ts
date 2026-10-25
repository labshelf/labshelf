/**
 * The options page shows a proxy template's kind or an error, and saves only rows whose template is valid.
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { PROXY_TEMPLATE_ERROR, checkTemplate, listWritableProxies } from "../../src/options/proxySection";

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
