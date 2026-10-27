// Section detection and section-scoped chunking.
import { detectSections, splitBySection } from "../../src/ai/chunk";
import type { ExtractedPdfText } from "../../src/ai/chunk";

describe("detectSections", () => {
  it("finds numbered headings and assigns ranges", () => {
    const pages = [
      {
        page: 1,
        text: [
          "1 Introduction",
          "Some introductory text spanning a paragraph.",
          "2 Related Work",
          "Earlier results discussed here.",
          "3 Method",
          "The proposed approach is...",
        ].join("\n"),
      },
    ];
    const sections = detectSections(pages);
    expect(sections.map((s) => s.heading)).toEqual([
      "1 Introduction",
      "2 Related Work",
      "3 Method",
    ]);
    expect(sections[0]!.endOffset).toBeGreaterThan(sections[0]!.startOffset);
  });

  it("recognises named sections without numbering", () => {
    const pages = [
      { page: 1, text: "Abstract\nThis paper introduces..." },
      { page: 2, text: "Introduction\nWe propose..." },
      { page: 3, text: "References\n[1] ..." },
    ];
    const sections = detectSections(pages);
    expect(sections.map((s) => s.heading)).toEqual(
      expect.arrayContaining(["Abstract", "Introduction", "References"]),
    );
  });

  it("returns empty when no headings match", () => {
    const pages = [{ page: 1, text: "just running text with no headings at all" }];
    expect(detectSections(pages)).toEqual([]);
  });
});

function makeExtracted(text: string): ExtractedPdfText {
  return {
    paperId: "p1",
    pages: [{ page: 1, text }],
    sections: [],
  };
}

describe("chunkBySection", () => {
  it("emits one chunk per detected section when each fits the budget", () => {
    const extracted = makeExtracted("1 Intro\nshort intro.\n2 Method\nshort method body.");
    const chunks = splitBySection(extracted);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.kind === "section")).toBe(true);
  });

  it("splits oversized sections on paragraph boundaries", () => {
    const para = "lorem ipsum ".repeat(300);
    const extracted = makeExtracted(`1 Big\n${para}\n\n${para}\n\n${para}`);
    const chunks = splitBySection(extracted);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(384 * 2);
    }
  });

  it("falls back to page chunking when no sections are detected", () => {
    const extracted: ExtractedPdfText = {
      paperId: "p1",
      pages: [
        { page: 1, text: "no headings here" },
        { page: 2, text: "still no headings" },
      ],
      sections: [],
    };
    const chunks = splitBySection(extracted);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.page).toBe(1);
  });
});
