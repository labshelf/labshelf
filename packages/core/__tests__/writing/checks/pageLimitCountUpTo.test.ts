/** Verifies that the page limit counts up to the References heading by default and to the end with countUpTo: end. */
import { runChecks, type PdfPageFacts } from "../../../src/writing/checks/index";

const page = (lines: string[]): PdfPageFacts => ({ lines, fonts: [], images: [] });
const pages = [page(["a"]), page(["b"]), page(["References", "[1] x"]), page(["[2] y"])];

function pageFindings(settings: { pages: number; anonymous: boolean; countUpTo?: "references" | "end" }) {
  return runChecks({ facts: { pages, info: {} }, sources: [], settings, gitUser: undefined }).filter((finding) => finding.rule === "pages");
}

describe("page limit with countUpTo", () => {
  it("stops at the References heading when countUpTo is absent", () => {
    expect(pageFindings({ pages: 2, anonymous: true })).toEqual([]);
  });

  it("stops at the References heading when countUpTo is references", () => {
    expect(pageFindings({ pages: 2, anonymous: true, countUpTo: "references" })).toEqual([]);
  });

  it("counts every page when countUpTo is end", () => {
    const findings = pageFindings({ pages: 2, anonymous: true, countUpTo: "end" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "pages", severity: "error" });
    expect(findings[0]!.message).toContain("4 pages");
  });

  it("passes with countUpTo end when all pages fit", () => {
    expect(pageFindings({ pages: 4, anonymous: true, countUpTo: "end" })).toEqual([]);
  });
});
