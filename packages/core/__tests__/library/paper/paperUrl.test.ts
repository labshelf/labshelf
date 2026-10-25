import { derivePaperUrl } from "../../../src/library/paper/index";

describe("paperLink", () => {
  it("builds a doi.org link from a bare DOI", () => {
    expect(derivePaperUrl({ doi: "10.5555/3295222.3295349" })).toBe("https://doi.org/10.5555/3295222.3295349");
  });

  it("strips a resolver prefix stored with the DOI instead of doubling it", () => {
    expect(derivePaperUrl({ doi: "https://doi.org/10.1/x" })).toBe("https://doi.org/10.1/x");
    expect(derivePaperUrl({ doi: "http://dx.doi.org/10.1/x" })).toBe("https://doi.org/10.1/x");
    expect(derivePaperUrl({ doi: "HTTPS://DOI.ORG/10.1/x" })).toBe("https://doi.org/10.1/x");
  });

  it("prefers the DOI over the URL", () => {
    expect(derivePaperUrl({ doi: "10.1/x", url: "https://example.org/x" })).toBe("https://doi.org/10.1/x");
  });

  it("falls back to the URL, and is undefined with neither", () => {
    expect(derivePaperUrl({ url: "https://arxiv.org/abs/1706.03762" })).toBe("https://arxiv.org/abs/1706.03762");
    expect(derivePaperUrl({ doi: "  ", url: "https://example.org/x" })).toBe("https://example.org/x");
    expect(derivePaperUrl({})).toBeUndefined();
  });
});
