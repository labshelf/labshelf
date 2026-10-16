import { isIgnoredProjectPath } from "@labshelf/core";

describe("isIgnoredProjectPath", () => {
  it.each([
    ".git", ".git/HEAD", "sub/.git", "sub/.git/objects/ab/cd",
    ".labshelf/state.json",
    ".labshelf/versions/.camera-ready.tmp-1/sources/main.tex",
    "../escape.tex", "a/../b.tex", "a\\b.tex",
  ])("leaves %s alone", (path) => {
    expect(isIgnoredProjectPath(path, [])).toBe(true);
  });

  it.each([
    "main.tex", "sections/intro.tex", ".gitignore", ".github/ci.yml",
    ".labshelf/versions/camera-ready/version.json", ".labshelf/other.json", "figures/.labshelf/state.json",
  ])("syncs %s", (path) => {
    expect(isIgnoredProjectPath(path, [])).toBe(false);
  });

  it("applies the project's patterns, and a pattern matching a folder covers everything under it", () => {
    const patterns = ["*.log", "data/raw", "build/**"];
    expect(isIgnoredProjectPath("run.log", patterns)).toBe(true);
    expect(isIgnoredProjectPath("sub/run.log", patterns)).toBe(false);
    expect(isIgnoredProjectPath("data/raw/a/b.csv", patterns)).toBe(true);
    expect(isIgnoredProjectPath("data/clean.csv", patterns)).toBe(false);
    expect(isIgnoredProjectPath("build/out/x.pdf", patterns)).toBe(true);
  });
});
