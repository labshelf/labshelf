/** Contract of the one mapping from what an app knows about a paper to the PDF finder's context. */
import { createResolveInput } from "@labshelf/core";

describe("createResolveInput", () => {
  it("carries identifiers, the record's title, authors and year, the landing page and the page's links", () => {
    const ctx = createResolveInput(
      { doi: "10.1/x", arxivId: "2301.00001", pmid: "42" },
      { title: "A title", authors: ["Ada Lovelace"], year: 2023 },
      "https://pub.example/a",
      [{ url: "https://pub.example/a.pdf", source: "page" }],
      { contactEmail: "me@uni.edu" },
    );
    expect(ctx).toEqual({
      doi: "10.1/x", arxivId: "2301.00001", pmid: "42", title: "A title", authors: ["Ada Lovelace"], year: 2023,
      landingUrl: "https://pub.example/a", pageCandidates: [{ url: "https://pub.example/a.pdf", source: "page" }],
      contactEmail: "me@uni.edu",
    });
  });

  it("falls back to the record's DOI, and reads the arXiv id off an arXiv DOI", () => {
    expect(createResolveInput({}, { doi: "10.1/y" }, undefined, [], { contactEmail: "a@b.c" })).toMatchObject({ doi: "10.1/y" });
    expect(createResolveInput({ doi: "10.48550/arXiv.hep-th/9711200" }, {}, undefined, [], { contactEmail: "a@b.c" })).toMatchObject({ arxivId: "hep-th/9711200" });
  });

  it("includes custom resolvers only when some are passed", () => {
    const customResolvers = [{ name: "A", template: "https://a.example/{doi}", enabled: true }];
    expect(createResolveInput({}, {}, undefined, [], { contactEmail: "a@b.c" })).not.toHaveProperty("customResolvers");
    expect(createResolveInput({}, {}, undefined, [], { contactEmail: "a@b.c", customResolvers: [] })).not.toHaveProperty("customResolvers");
    expect(createResolveInput({}, {}, undefined, [], { contactEmail: "a@b.c", customResolvers })).toMatchObject({ customResolvers });
  });

  it("leaves out what is unknown", () => {
    expect(createResolveInput({}, {}, undefined, [], { contactEmail: "a@b.c" })).toEqual({ pageCandidates: [], contactEmail: "a@b.c" });
  });
});
