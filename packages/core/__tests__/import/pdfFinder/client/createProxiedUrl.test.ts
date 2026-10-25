/** Contract of the library-proxy rewrites: the kind follows from the template, and each kind rewrites a URL its own way. */
import { createProxiedUrl, deriveProxyKind } from "@labshelf/core";

const ARTICLE = "https://www.sciencedirect.com/science/article/pii/S0010027701001536?via=ihub";

describe("proxyKind", () => {
  it.each([
    ["https://login.ezproxy.uni.edu/login?url=$@", "prefix"],
    ["http://proxy.lib.uni.edu/$@", "prefix"],
    [".ezproxy.uni.edu", "hostname"],
    ["ezproxy.uni.edu", "hostname"],
    ["https://go.openathens.net/redirector/uni.edu", "openathens"],
    ["https://go.openathens.net/redirector/uni.edu?url=$@", "openathens"],
  ])("reads %s as %s", (template, kind) => {
    expect(deriveProxyKind(template)).toBe(kind);
  });

  it.each(["", "not a proxy", "ftp://proxy.uni.edu/$@", "$@", "https://login.ezproxy.uni.edu/login?url="])("rejects %p", (template) => {
    expect(deriveProxyKind(template)).toBeUndefined();
  });
});

describe("proxiedUrl", () => {
  it("puts the URL where a prefix template holds $@, as is", () => {
    expect(createProxiedUrl("https://login.ezproxy.uni.edu/login?url=$@", ARTICLE)).toBe(`https://login.ezproxy.uni.edu/login?url=${ARTICLE}`);
  });

  it("folds the publisher's host into a hostname proxy, keeping the path and query", () => {
    expect(createProxiedUrl(".ezproxy.uni.edu", ARTICLE))
      .toBe("https://www-sciencedirect-com.ezproxy.uni.edu/science/article/pii/S0010027701001536?via=ihub");
  });

  it("doubles the hyphens a host already has, as EZproxy does", () => {
    expect(createProxiedUrl("ezproxy.uni.edu", "https://www.ams-journal.org/a.pdf")).toBe("https://www-ams--journal-org.ezproxy.uni.edu/a.pdf");
  });

  it("encodes the URL into the OpenAthens redirector", () => {
    expect(createProxiedUrl(" https://go.openathens.net/redirector/uni.edu?url=$@ ", ARTICLE))
      .toBe(`https://go.openathens.net/redirector/uni.edu?url=${encodeURIComponent(ARTICLE)}`);
  });

  it("gives nothing for an unreadable template or a URL that is not http(s)", () => {
    expect(createProxiedUrl("not a proxy", ARTICLE)).toBeUndefined();
    expect(createProxiedUrl(".ezproxy.uni.edu", "mailto:someone@uni.edu")).toBeUndefined();
  });
});
