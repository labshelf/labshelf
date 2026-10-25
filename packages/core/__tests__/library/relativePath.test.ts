/** Verifies the rules every relative path inside a library folder must follow. */
import { checkRelativePath } from "../../src/library/index";

describe("relativePathProblem", () => {
  it.each(["main.tex", "sections/intro.tex", ".gitignore", "a/b/c/d.tex"])("accepts %s", (path) => {
    expect(checkRelativePath(path)).toBeUndefined();
  });

  it.each([
    ["a\\b.tex", "backslash"], ["/etc/passwd", "absolute"], ["C:/x.tex", "drive letter"], ["c:x", "drive letter"],
    ["a\u0000b", "control character"], ["a\u001fb", "control character"], ["a//b", "empty segment"], ["", "empty segment"],
    ["a/", "empty segment"], ["../x", "\"..\""], ["a/./b", "\".\""], ["chapters/../../x", "\"..\""],
  ])("refuses %j because it %s", (path, why) => {
    expect(checkRelativePath(path)).toContain(why);
  });
});
