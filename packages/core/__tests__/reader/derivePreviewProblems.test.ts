// Pins how located build problems become the problems a preview root shows.
import { derivePreviewProblems } from "../../src/reader/index.js";

describe("derivePreviewProblems", () => {
  it("keeps the fields a preview root shows and drops the empty ones", () => {
    const problems = derivePreviewProblems([
      { severity: "error", message: "Undefined control sequence", hint: "Check the macro", file: "main.tex", line: 4, kind: "overfull" },
      { severity: "warning", message: "Overfull", hint: "", file: "" },
    ]);
    expect(problems).toEqual([
      { severity: "error", message: "Undefined control sequence", hint: "Check the macro", file: "main.tex", line: 4 },
      { severity: "warning", message: "Overfull" },
    ]);
  });

  it("names each file the way the host asks", () => {
    const problems = derivePreviewProblems([{ severity: "info", message: "m", file: "/p/a.tex" }], (file) => file.slice(3));
    expect(problems).toEqual([{ severity: "info", message: "m", file: "a.tex" }]);
  });
});
