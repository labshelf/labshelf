/** Verifies that problems a section document reports point at the edited file's own lines. */
import { mapSectionProblems } from "../../../../src/latex/build/section/index";

describe("mapSectionProblems", () => {
  const place = { documentName: "main-section.tex", editedFile: "chapters/chap.tex", headerLines: 5, startLine: 10 };

  it("moves a problem on a section line to the edited file and its 1-based source line", () => {
    const problems = mapSectionProblems([{ severity: "error", message: "Undefined control sequence.", file: "/out/main-section.tex", line: 6 }], place);
    expect(problems).toEqual([{ severity: "error", message: "Undefined control sequence.", file: "chapters/chap.tex", line: 11 }]);
  });

  it("puts a problem on a header line on the section's heading and leaves other files alone", () => {
    const problems = mapSectionProblems([
      { severity: "warning", message: "w", file: "./main-section.tex", line: 2 },
      { severity: "warning", message: "x", file: "./chapters/other.tex", line: 3 },
    ], place);
    expect(problems).toEqual([
      { severity: "warning", message: "w", file: "chapters/chap.tex", line: 11 },
      { severity: "warning", message: "x", file: "./chapters/other.tex", line: 3 },
    ]);
  });
});
