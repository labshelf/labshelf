/** The options page shows a proxy template's kind or an error, and saves only rows whose template is valid. */
import { PROXY_TEMPLATE_ERROR, judgeTemplate, savableProxies } from "../../../src/options/proxy/proxyRows";

describe("judgeTemplate", () => {
  it("names the kind of each valid shape", () => {
    expect(judgeTemplate("https://login.ezproxy.uni.edu/login?url=$@")).toEqual({ kind: "prefix", label: "Prefix" });
    expect(judgeTemplate(".ezproxy.uni.edu")).toEqual({ kind: "hostname", label: "Hostname" });
    expect(judgeTemplate("https://go.openathens.net/redirector/uni.edu")).toEqual({ kind: "openathens", label: "OpenAthens" });
  });

  it("reports an error for text that is none of them and nothing for an empty field", () => {
    expect(judgeTemplate("https://login.ezproxy.uni.edu/login")).toEqual({ error: PROXY_TEMPLATE_ERROR });
    expect(judgeTemplate("  ")).toBeUndefined();
  });
});

describe("savableProxies", () => {
  it("drops invalid rows, keeps the order and trims the fields", () => {
    expect(savableProxies([
      { name: " A ", template: " .ezproxy.a.edu ", enabled: true },
      { name: "bad", template: "nope", enabled: true },
      { name: "", template: "https://p.example/login?url=$@", enabled: false },
    ])).toEqual([
      { name: "A", template: ".ezproxy.a.edu", enabled: true },
      { name: "https://p.example/login?url=$@", template: "https://p.example/login?url=$@", enabled: false },
    ]);
  });
});
