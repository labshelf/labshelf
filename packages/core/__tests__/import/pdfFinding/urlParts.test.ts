import { originOf, siteOf } from "../../../src/import/pdfFinding/urlParts";

describe("originOf", () => {
  it("lower-cases the origin and keeps a non-default port", () => {
    expect(originOf("HTTPS://Www.Nature.com:8443/articles/x?y#z")).toBe("https://www.nature.com:8443");
  });

  it("is undefined for anything but an absolute http(s) URL", () => {
    expect(originOf("ftp://host/x")).toBeUndefined();
    expect(originOf("/relative/path")).toBeUndefined();
    expect(originOf("not a url")).toBeUndefined();
  });
});

describe("siteOf", () => {
  it("keeps the last two labels of the host, without port", () => {
    expect(siteOf("https://www.nature.com:443/x")).toBe("nature.com");
    expect(siteOf("https://arxiv.org/abs/1")).toBe("arxiv.org");
  });
});
