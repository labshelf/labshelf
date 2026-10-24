/** Verifies the template path and file-tree rules. */
import { templatePathProblem, templateTreeProblem } from "../../../src/templates/index";

const MiB = 1024 * 1024;

describe("templatePathProblem", () => {
  it.each(["main.tex", "sections/intro.tex", ".gitignore", "fig/a.b.png", "a/b/c/d.tex", "latexmkrc.txt", "x".repeat(255)])(
    "accepts %s", (path) => {
      expect(templatePathProblem(path)).toBeUndefined();
    },
  );

  it.each([
    ["a\\b.tex"], ["..\\x"], ["../main.tex"], ["a/../b.tex"], ["a/.."], ["."], ["./main.tex"], ["a/./b"],
    ["/main.tex"], ["a//b.tex"], ["a/"], [""], ["C:main.tex"], ["c:/x.tex"], ["a\u0000b"], ["a\u001fb"], ["a\u007fb"], ["a\tb"],
    ["latexmkrc"], [".latexmkrc"], [".LatexMkRC"], ["LATEXMKRC"], ["sub/latexmkrc"], ["latexmkrc/x.tex"],
    [".git/config"], ["a/.git/x"], ["a/.GIT"], [".Git"], ["x".repeat(256)],
  ])("refuses %j and names the path", (path) => {
    const problem = templatePathProblem(path);
    expect(typeof problem).toBe("string");
    expect(problem).toContain(path);
  });
});

describe("templateTreeProblem", () => {
  const ok = [{ path: "main.tex", size: 10 }, { path: "sections/intro.tex", size: 20 }];

  it("accepts a valid tree and an empty tree", () => {
    expect(templateTreeProblem(ok)).toBeUndefined();
    expect(templateTreeProblem([])).toBeUndefined();
  });

  it("reports a bad path", () => {
    expect(templateTreeProblem([...ok, { path: "../x", size: 1 }])).toContain("../x");
  });

  it("refuses labshelf.yaml at the root in any case", () => {
    expect(templateTreeProblem([{ path: "labshelf.yaml", size: 1 }])).toContain("labshelf.yaml");
    expect(templateTreeProblem([{ path: "LabShelf.YAML", size: 1 }])).toContain("LabShelf.YAML");
  });

  it("allows labshelf.yaml in a subfolder", () => {
    expect(templateTreeProblem([{ path: "sub/labshelf.yaml", size: 1 }])).toBeUndefined();
  });

  it("refuses two paths that differ only in case", () => {
    const problem = templateTreeProblem([{ path: "Fig/A.png", size: 1 }, { path: "fig/a.png", size: 1 }]);
    expect(typeof problem).toBe("string");
  });

  it("allows 500 files and refuses 501", () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.tex`, size: 1 }));
    expect(templateTreeProblem(files(500))).toBeUndefined();
    expect(typeof templateTreeProblem(files(501))).toBe("string");
  });

  it("allows 5 MiB and refuses 5 MiB + 1 for one file", () => {
    expect(templateTreeProblem([{ path: "a.bin", size: 5 * MiB }])).toBeUndefined();
    expect(templateTreeProblem([{ path: "a.bin", size: 5 * MiB + 1 }])).toContain("a.bin");
  });

  it("allows 20 MiB in all and refuses 20 MiB + 1", () => {
    const files = (extra: number) => [
      { path: "a", size: 5 * MiB }, { path: "b", size: 5 * MiB }, { path: "c", size: 5 * MiB },
      { path: "d", size: 5 * MiB - 1 + extra },
    ];
    expect(templateTreeProblem(files(1))).toBeUndefined();
    expect(typeof templateTreeProblem(files(2))).toBe("string");
  });
});
