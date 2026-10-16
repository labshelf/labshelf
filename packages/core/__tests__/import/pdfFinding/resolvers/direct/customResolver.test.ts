/** Contract of the custom resolver: it builds addresses from the user's enabled templates and never fetches itself. */
import { customResolver, isCustomResolverTemplate } from "../../../../../src/import/pdfFinding/resolvers/index";
import { makeContext, makeFindingHarness } from "../../../../support/pdfFindingHarness";

describe("customResolver", () => {
  it("proposes nothing and contacts no host without templates", async () => {
    const h = makeFindingHarness();
    expect(await customResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("puts the DOI into the template raw, slashes kept", async () => {
    const h = makeFindingHarness();
    const customResolvers = [{ name: "A", template: "https://host.example/find/{doi}?lang=en", enabled: true }];
    expect(await customResolver.resolve(makeContext({ doi: "10.1/x(y)", customResolvers }), h.env)).toEqual([
      "https://host.example/find/10.1/x(y)?lang=en",
    ]);
    expect(h.calls).toEqual([]);
  });

  it("skips disabled entries and keeps the order of the rest", async () => {
    const h = makeFindingHarness();
    const customResolvers = [
      { name: "A", template: "https://a.example/{doi}", enabled: true },
      { name: "B", template: "https://b.example/{doi}", enabled: false },
      { name: "C", template: "https://c.example/{doi}", enabled: true },
    ];
    expect(await customResolver.resolve(makeContext({ doi: "10.1/x", customResolvers }), h.env)).toEqual([
      "https://a.example/10.1/x", "https://c.example/10.1/x",
    ]);
  });

  it("proposes nothing for a paper without a DOI", async () => {
    const h = makeFindingHarness();
    const customResolvers = [{ name: "A", template: "https://a.example/{doi}", enabled: true }];
    expect(await customResolver.resolve(makeContext({ arxivId: "2301.00001", customResolvers }), h.env)).toEqual([]);
  });
});

describe("isCustomResolverTemplate", () => {
  it("accepts an http(s) address with a {doi} placeholder only", () => {
    expect(isCustomResolverTemplate("https://host.example/find/{doi}")).toBe(true);
    expect(isCustomResolverTemplate("http://host.example/?q={doi}")).toBe(true);
    expect(isCustomResolverTemplate("https://host.example/find")).toBe(false);
    expect(isCustomResolverTemplate("ftp://host.example/{doi}")).toBe(false);
    expect(isCustomResolverTemplate("host.example/{doi}")).toBe(false);
    expect(isCustomResolverTemplate("https://host.example/a b/{doi}")).toBe(false);
  });
});
