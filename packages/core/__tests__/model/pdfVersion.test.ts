import { compareVersions, isPdfVersion, isPreferredVersion, type PdfVersion } from "@labshelf/core";

describe("isPdfVersion", () => {
  it("accepts the three versions and nothing else", () => {
    for (const v of ["preprint", "accepted", "published"]) expect(isPdfVersion(v)).toBe(true);
    for (const v of ["Preprint", "", "final", null, undefined, 3]) expect(isPdfVersion(v)).toBe(false);
  });
});

describe("outranksVersion and compareVersions", () => {
  it("ranks published above accepted above preprint", () => {
    expect(isPreferredVersion("published", "accepted")).toBe(true);
    expect(isPreferredVersion("accepted", "preprint")).toBe(true);
    expect(isPreferredVersion("published", "preprint")).toBe(true);
    expect(isPreferredVersion("preprint", "accepted")).toBe(false);
    expect(isPreferredVersion("accepted", "published")).toBe(false);
  });

  it("counts an unknown version as published", () => {
    expect(isPreferredVersion(undefined, "accepted")).toBe(true);
    expect(isPreferredVersion(undefined, "preprint")).toBe(true);
    expect(isPreferredVersion("accepted", undefined)).toBe(false);
    expect(isPreferredVersion("preprint", undefined)).toBe(false);
  });

  it("does not outrank an equal version", () => {
    for (const v of ["preprint", "accepted", "published", undefined] as Array<PdfVersion | undefined>) expect(isPreferredVersion(v, v)).toBe(false);
    expect(isPreferredVersion("published", undefined)).toBe(false);
    expect(isPreferredVersion(undefined, "published")).toBe(false);
  });

  it("sorts the preferred version first", () => {
    const versions: Array<PdfVersion | undefined> = ["preprint", "accepted", "published"];
    expect([...versions].sort(compareVersions)).toEqual(["published", "accepted", "preprint"]);
    expect(compareVersions("published", undefined)).toBe(0);
    expect(compareVersions(undefined, "accepted")).toBeLessThan(0);
    expect(compareVersions("preprint", undefined)).toBeGreaterThan(0);
  });
});
