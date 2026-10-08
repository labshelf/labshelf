import { paperLink } from "../../../src/library/format/index";

describe("paperLink", () => {
  it("builds a doi.org link from a bare DOI", () => {
    expect(paperLink({ doi: "10.5555/3295222.3295349" })).toBe("https://doi.org/10.5555/3295222.3295349");
  });

  it("strips a resolver prefix stored with the DOI instead of doubling it", () => {
    expect(paperLink({ doi: "https://doi.org/10.1/x" })).toBe("https://doi.org/10.1/x");
    expect(paperLink({ doi: "http://dx.doi.org/10.1/x" })).toBe("https://doi.org/10.1/x");
    expect(paperLink({ doi: "HTTPS://DOI.ORG/10.1/x" })).toBe("https://doi.org/10.1/x");
  });

  it("prefers the DOI over the URL", () => {
    expect(paperLink({ doi: "10.1/x", url: "https://example.org/x" })).toBe("https://doi.org/10.1/x");
  });

  it("falls back to the URL, and is undefined with neither", () => {
    expect(paperLink({ url: "https://arxiv.org/abs/1706.03762" })).toBe("https://arxiv.org/abs/1706.03762");
    expect(paperLink({ doi: "  ", url: "https://example.org/x" })).toBe("https://example.org/x");
    expect(paperLink({})).toBeUndefined();
  });
});
