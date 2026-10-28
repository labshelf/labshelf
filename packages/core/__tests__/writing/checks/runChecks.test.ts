/** Verifies the pre-submission rules: page limit, anonymity, unresolved references, Type 3 fonts and image resolution. */
import type { PdfPageFacts } from "../../../src/writing/checks/pdfFacts";
import { runChecks, type CheckInput } from "../../../src/writing/checks/runChecks";

describe("runChecks", () => {
  const page = (lines: string[], extra: Partial<PdfPageFacts> = {}): PdfPageFacts => ({ lines, fonts: [], images: [], ...extra });

  function check(pages: PdfPageFacts[], overrides: Partial<CheckInput> = {}) {
    return runChecks({ facts: { pages, info: {} }, sources: [], settings: undefined, gitUser: undefined, ...overrides });
  }

  const anonymous = { anonymous: true };

  describe("runChecks", () => {
    it("passes a clean paper", () => {
      expect(check([page(["Abstract", "We study things."])], { settings: { pages: 1, ...anonymous } })).toEqual([]);
    });

    it("flags pages before the references over the limit, and only then", () => {
      const pages = [page(["a"]), page(["b"]), page(["References", "[1] x"])];
      expect(check(pages, { settings: { pages: 2, ...anonymous } })).toEqual([]);
      expect(check(pages, { settings: { pages: 1, ...anonymous } })).toEqual([
        expect.objectContaining({ rule: "pages", severity: "error", message: "The paper has 2 pages before the references; the limit is 1.", location: { kind: "pdf" } }),
      ]);
    });

    it("says when every page counts because no references heading was found", () => {
      const [finding] = check([page(["a"]), page(["b"])], { settings: { pages: 1, ...anonymous } });
      expect(finding!.message).toContain("2 pages (no References heading found");
    });

    it("flags an author name in the body at the source line that wrote it, but not in the references", () => {
      const sources = [{ file: "/p/main.tex", lines: ["% Jane Doe wrote this", "\\author{Jane~Doe}"] }];
      const findings = check([page(["Jane Doe", "Intro"]), page(["References", "[1] J. Doe and Jane Doe. 2020."])], { sources, gitUser: "Jane Doe" });
      expect(findings).toEqual([
        { rule: "anonymity", severity: "error", message: "\"Jane Doe\" appears on page 1; an anonymous submission must not name its authors.", location: { kind: "source", file: "/p/main.tex", line: 2 } },
      ]);
    });

    it("matches names whole, case-blind and across a line break, and points at the page when no source has them", () => {
      const findings = check([page(["Thanks to JOHN", "ROE."]), page(["Johnroe is a word."])], { settings: { authors: ["John Roe"], ...anonymous } });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.location).toEqual({ kind: "pdf", page: 1 });
    });

    it("flags the PDF author field, and names from it in the text", () => {
      const findings = check([page(["By Jane Doe"])], { facts: { pages: [page(["By Jane Doe"])], info: { Author: "Jane Doe", Title: "A paper" } } });
      expect(findings.map((finding) => finding.message)).toEqual([
        "The PDF's Author field names an author (Jane Doe); clear it, e.g. \\hypersetup{pdfauthor={}}.",
        "\"Jane Doe\" appears on page 1; an anonymous submission must not name its authors.",
      ]);
    });

    it("warns about self-references and personal links", () => {
      const sources = [{ file: "/p/intro.typ", lines: ["Code: https://github.com/janedoe/tool // our previous work", "As in our previous work, we"] }];
      const findings = check([page(["As in our previous work, we", "Code: https://github.com/janedoe/tool"]), page(["References", "see jane.github.io"])], { sources });
      expect(findings.map(({ severity, message, location }) => [severity, message, location])).toEqual([
        ["warning", "\"our previous work\" on page 1 can reveal the authors; cite your own work in the third person.", { kind: "source", file: "/p/intro.typ", line: 2 }],
        ["warning", "\"github.com/janedoe/tool\" on page 1 can reveal the authors; link an anonymized copy instead.", { kind: "source", file: "/p/intro.typ", line: 1 }],
        ["warning", "\"jane.github.io\" on page 2 can reveal the authors; link an anonymized copy instead.", { kind: "pdf", page: 2 }],
      ]);
    });

    it("skips every anonymity rule for a camera-ready", () => {
      const facts = { pages: [page(["Jane Doe, our previous work, github.com/jd/x"])], info: { Author: "Jane Doe" } };
      expect(check([], { facts, gitUser: "Jane Doe", settings: { anonymous: false } })).toEqual([]);
    });

    it("counts unresolved references and citations per page", () => {
      const findings = check([page(["See Section ??.", "As shown [?, ?] and (?)."]), page(["Fine [3]."])]);
      expect(findings).toEqual([
        { rule: "references", severity: "error", message: "3 unresolved references or citations (?? or [?]) on page 1.", location: { kind: "pdf", page: 1 } },
      ]);
    });

    it("lists the pages with Type 3 fonts in one warning", () => {
      const type3 = { fonts: [{ name: "Type3", type3: true }] };
      const [finding] = check([page([], type3), page([]), page([], type3)]);
      expect(finding).toMatchObject({ rule: "fonts", severity: "warning", location: { kind: "pdf", page: 1 } });
      expect(finding!.message).toMatch(/^Type 3 fonts on pages 1, 3;/);
    });

    it("warns about images printed under 300 dpi", () => {
      const images = [
        { pixelWidth: 50, pixelHeight: 50, width: 144, height: 144 },
        { pixelWidth: 1200, pixelHeight: 600, width: 288, height: 144 },
      ];
      const findings = check([page([], { images })]);
      expect(findings.map((finding) => finding.message)).toEqual([
        "A 50×50 image on page 1 prints at 25 dpi, under 300; export the figure as a vector PDF or at a higher resolution.",
      ]);
    });

    it("puts errors before warnings", () => {
      const findings = check([page(["github.com/me/x", "??"], { fonts: [{ name: "Type3", type3: true }] })]);
      expect(findings.map((finding) => finding.severity)).toEqual(["error", "warning", "warning"]);
    });
  });
});

describe("pageLimitCountUpTo", () => {
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
});
