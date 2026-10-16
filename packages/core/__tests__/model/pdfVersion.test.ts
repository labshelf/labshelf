import { compareVersions, isPdfVersion, outranksVersion, type PdfVersion } from "@labshelf/core";

describe("isPdfVersion", () => {
  it("accepts the three versions and nothing else", () => {
    for (const v of ["preprint", "accepted", "published"]) expect(isPdfVersion(v)).toBe(true);
    for (const v of ["Preprint", "", "final", null, undefined, 3]) expect(isPdfVersion(v)).toBe(false);
  });
});

describe("outranksVersion and compareVersions", () => {
  it("ranks published above accepted above preprint", () => {
    expect(outranksVersion("published", "accepted")).toBe(true);
    expect(outranksVersion("accepted", "preprint")).toBe(true);
    expect(outranksVersion("published", "preprint")).toBe(true);
    expect(outranksVersion("preprint", "accepted")).toBe(false);
    expect(outranksVersion("accepted", "published")).toBe(false);
  });

  it("counts an unknown version as published", () => {
    expect(outranksVersion(undefined, "accepted")).toBe(true);
    expect(outranksVersion(undefined, "preprint")).toBe(true);
    expect(outranksVersion("accepted", undefined)).toBe(false);
    expect(outranksVersion("preprint", undefined)).toBe(false);
  });

  it("does not outrank an equal version", () => {
    for (const v of ["preprint", "accepted", "published", undefined] as Array<PdfVersion | undefined>) expect(outranksVersion(v, v)).toBe(false);
    expect(outranksVersion("published", undefined)).toBe(false);
    expect(outranksVersion(undefined, "published")).toBe(false);
  });

  it("sorts the preferred version first", () => {
    const versions: Array<PdfVersion | undefined> = ["preprint", "accepted", "published"];
    expect([...versions].sort(compareVersions)).toEqual(["published", "accepted", "preprint"]);
    expect(compareVersions("published", undefined)).toBe(0);
    expect(compareVersions(undefined, "accepted")).toBeLessThan(0);
    expect(compareVersions("preprint", undefined)).toBeGreaterThan(0);
  });
});
