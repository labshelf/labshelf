import { deriveOrigin, deriveSite } from "../../../src/import/pdfFinder/urlParts";

describe("originOf", () => {
  it("lower-cases the origin and keeps a non-default port", () => {
    expect(deriveOrigin("HTTPS://Www.Nature.com:8443/articles/x?y#z")).toBe("https://www.nature.com:8443");
  });

  it("is undefined for anything but an absolute http(s) URL", () => {
    expect(deriveOrigin("ftp://host/x")).toBeUndefined();
    expect(deriveOrigin("/relative/path")).toBeUndefined();
    expect(deriveOrigin("not a url")).toBeUndefined();
  });
});

describe("siteOf", () => {
  it("keeps the last two labels of the host, without port", () => {
    expect(deriveSite("https://www.nature.com:443/x")).toBe("nature.com");
    expect(deriveSite("https://arxiv.org/abs/1")).toBe("arxiv.org");
  });
});
