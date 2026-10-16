/** Verifies Typst diagnostics become located build problems. */
import { typstProblems, type TypstDiagnostic } from "../../../src/writing/typst/index";

const MAIN = "/proj/main.typ";
const resolve = (compilerPath: string): string => `/resolved${compilerPath}`;

function diagnostic(overrides: Partial<TypstDiagnostic>): TypstDiagnostic {
  return { package: "", path: "/proj/main.typ", severity: "error", range: "2:4-2:9", message: "boom", ...overrides };
}

describe("typstProblems", () => {
  it("converts the zero-based start line to one-based and resolves the path", () => {
    expect(typstProblems([diagnostic({ path: "/proj/ch.typ" })], MAIN, resolve)).toEqual([
      { severity: "error", message: "boom", file: "/resolved/proj/ch.typ", line: 3 },
    ]);
  });

  it("omits the line when the diagnostic has no span", () => {
    const [problem] = typstProblems([diagnostic({ range: "" })], MAIN, resolve);
    expect(problem).toEqual({ severity: "error", message: "boom", file: "/resolved/proj/main.typ" });
  });

  it("drops hint diagnostics", () => {
    expect(typstProblems([diagnostic({ severity: "hint" })], MAIN, resolve)).toEqual([]);
  });

  it("keeps warnings as warnings", () => {
    expect(typstProblems([diagnostic({ severity: "warning" })], MAIN, resolve)[0]).toMatchObject({ severity: "warning" });
  });

  it("places a diagnostic inside a package on the main file and names the package", () => {
    expect(typstProblems([diagnostic({ package: "preview/x:1.0.0", path: "/cache/x/lib.typ" })], MAIN, resolve)).toEqual([
      { severity: "error", message: "boom (in package preview/x:1.0.0)", file: MAIN },
    ]);
  });

  it("places a diagnostic with an empty path on the main file", () => {
    expect(typstProblems([diagnostic({ path: "", range: "" })], MAIN, resolve)).toEqual([{ severity: "error", message: "boom", file: MAIN }]);
  });
});
