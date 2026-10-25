/** Verifies how an edit is mapped to the recorded section that holds it, and every reason a section cannot be previewed alone. */
import { createSectionPreviewPlan } from "../../../../src/latex/build/section/index";
import type { SectionPreviewInput, SectionState } from "../../../../src/latex/build/section/index";

const MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\tableofcontents",
  "\\section{Intro}",
  "Text.",
  "\\section*{Notes}",
  "More.",
  "\\input{chap}",
  "\\end{document}",
].join("\n");
const CHAP = "\\section{Method}\nm\n\\subsection{Detail}\nd\n";

const state = (command: string, line: number, file: string): SectionState => ({ command, absolutePage: 1, fillingPage: 1, line, file, pageBoundary: true, counters: {} });
// The first record is the kernel's `\section*` inside `\tableofcontents`, which has no heading in the source.
const STATES = [
  state("section", 3, "main.tex"), state("section", 4, "main.tex"), state("section", 6, "main.tex"),
  state("section", 1, "chap.tex"), state("subsection", 3, "chap.tex"),
];

function plan(overrides: Partial<SectionPreviewInput>): ReturnType<typeof createSectionPreviewPlan> {
  return createSectionPreviewPlan({
    editedFile: "main.tex", editedLine: 4, sources: { "main.tex": MAIN, "chap.tex": CHAP },
    states: STATES, hasAux: true, engine: "pdflatex", hasFormat: true, ...overrides,
  });
}

const withSection = (body: string): Partial<SectionPreviewInput> => {
  const main = MAIN.replace("Text.", body);
  return { sources: { "main.tex": main, "chap.tex": CHAP, "defs.tex": "\\def\\x{x}", "plain.tex": "words" } };
};

describe("createSectionPreviewPlan", () => {
  it("matches the heading by file and line, past a kernel record", () => {
    expect(plan({})).toEqual({ kind: "section", sectionIndex: 1, startLine: 3, endLine: 5, file: "main.tex" });
  });

  it("ends a section before an input that holds the next heading", () => {
    expect(plan({ editedLine: 6 })).toEqual({ kind: "section", sectionIndex: 2, startLine: 5, endLine: 7, file: "main.tex" });
  });

  it("finds a section in an input file and ends it at the next heading of any recorded level", () => {
    expect(plan({ editedFile: "./chap.tex", editedLine: 1 }))
      .toEqual({ kind: "section", sectionIndex: 3, startLine: 0, endLine: 2, file: "chap.tex" });
  });

  it("ends the last section of the main file at end document", () => {
    const main = MAIN.replace("\\input{chap}", "tail");
    expect(plan({ sources: { "main.tex": main }, editedLine: 7 }))
      .toEqual({ kind: "section", sectionIndex: 2, startLine: 5, endLine: 8, file: "main.tex" });
  });

  it.each<[string, Partial<SectionPreviewInput>]>([
    ["no-full-build", { states: [] }],
    ["no-full-build", { hasAux: false }],
    ["engine", { engine: "xelatex" }],
    ["no-format", { hasFormat: false }],
    ["outside-section", { editedLine: 2 }],
    ["no-matching-state", { states: STATES.filter((entry) => entry.line !== 4) }],
    ["include", withSection("\\include{part}")],
    ["input-with-definitions", withSection("\\input{defs}")],
    ["input-unreadable", withSection("\\input{gone}")],
    ["unclosed-float", withSection("\\begin{figure}[t]\\begin{table}x\\end{table}")],
    ["afterpage", withSection("\\afterpage{\\clearpage}")],
  ])("falls back with %s", (reason, overrides) => {
    expect(plan(overrides)).toEqual({ kind: "fallback", reason });
  });

  it("previews a section with includegraphics, a closed float and an input without definitions", () => {
    expect(plan(withSection("\\includegraphics{a}\\begin{figure*}x\\end{figure*}\\input{plain}")).kind).toBe("section");
  });
});


it("requires page boundaries at both ends of an isolated section", () => {
  for (const index of [1, 2]) {
    const states = STATES.map((state, at) => at === index ? { ...state, pageBoundary: false } : state);
    expect(plan({ states })).toEqual({ kind: "fallback", reason: "shared-page" });
  }
});
