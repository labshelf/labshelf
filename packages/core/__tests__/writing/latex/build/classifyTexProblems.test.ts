import { parseTexLog } from "../../../../src/writing/latex/log/index.js";

import { classifyTexProblems } from "../../../../src/writing/latex/build/classifyTexProblems";

type Problem = { severity: "error" | "warning" | "info"; message: string };
const error = (message: string): Problem => ({ severity: "error", message });

describe("classifyTexProblems", () => {
  it("reports a missing package as <name>.sty", () => {
    expect(classifyTexProblems([error('Package "foo" is not installed.')])).toEqual({ missingFile: "foo.sty" });
  });

  it("reports a missing document class as <name>.cls", () => {
    expect(classifyTexProblems([error('Document class "ieeetran" is not installed.')])).toEqual({ missingFile: "ieeetran.cls" });
  });

  it("reports another missing file as written", () => {
    expect(classifyTexProblems([error('File "logo.png" not found.')])).toEqual({ missingFile: "logo.png" });
  });

  it("finds the file behind a source prefix", () => {
    expect(classifyTexProblems([error('LaTeX Error: Package "foo" is not installed.')])).toEqual({ missingFile: "foo.sty" });
  });

  it("reports shell escape and minted errors with a reason naming them", () => {
    const minted = classifyTexProblems([error("Package minted Error: You must invoke LaTeX with the -shell-escape flag.")]);
    expect(minted.shellEscape).toMatch(/minted/);
    const plain = classifyTexProblems([error("Write18 shell escape is disabled")]);
    expect(plain.shellEscape).toMatch(/shell escape/i);
    expect(minted.missingFile).toBeUndefined();
  });

  it("ignores warnings", () => {
    expect(classifyTexProblems([{ severity: "warning", message: "minted shell escape" }])).toEqual({});
  });

  it("returns nothing for unrelated problems and for none", () => {
    expect(classifyTexProblems([error("Unknown command \\foo.")])).toEqual({});
    expect(classifyTexProblems([])).toEqual({});
  });

  it("understands what the core log parser writes for a missing package", () => {
    const log = "This is pdfTeX\n! LaTeX Error: File `foo.sty' not found.\n\nType X to quit.\n\nl.3 \\usepackage{foo}\n";
    expect(classifyTexProblems(parseTexLog(log, "pdflatex"))).toEqual({ missingFile: "foo.sty" });
  });
});
