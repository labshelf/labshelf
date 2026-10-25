/** Verifies include paths resolve against the project root and never leave it. */
import { resolveIncludePath } from "../../../../src/latex/index";

describe("resolveIncludePath", () => {
  it("adds .tex only when the name has no extension", () => {
    expect(resolveIncludePath("chapters/intro")).toBe("chapters/intro.tex");
    expect(resolveIncludePath("chapters/intro.tex")).toBe("chapters/intro.tex");
    expect(resolveIncludePath("fig/plot.pgf")).toBe("fig/plot.pgf");
  });

  it("normalises dot segments and slashes", () => {
    expect(resolveIncludePath("./a//b/../c")).toBe("a/c.tex");
  });

  it("refuses absolute paths, escapes from the project and paths with macros", () => {
    expect(resolveIncludePath("/etc/passwd")).toBeUndefined();
    expect(resolveIncludePath("../outside")).toBeUndefined();
    expect(resolveIncludePath("a/../../b")).toBeUndefined();
    expect(resolveIncludePath("\\chapterdir/a")).toBeUndefined();
    expect(resolveIncludePath("")).toBeUndefined();
  });
});
