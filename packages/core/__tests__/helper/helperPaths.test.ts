/** Verifies the path and project-id rules every helper message applies before touching the helper's data folder. */
import { checkHelperPath, isHelperProjectId } from "../../src/helper/index";

describe("checkHelperPath", () => {
  it.each(["main.tex", "chapters/intro.tex", "figures/a b/plot.pdf", ".latexmkrc", "a..b/c.tex"])("accepts %s", (path) => {
    expect(checkHelperPath(path)).toBeUndefined();
  });

  it.each([
    ["empty", ""],
    ["a parent segment", "../main.tex"],
    ["a nested parent segment", "chapters/../../main.tex"],
    ["a leading slash", "/etc/passwd"],
    ["a backslash", "chapters\\intro.tex"],
    ["a NUL", "main\u0000.tex"],
    ["a drive letter", "C:/main.tex"],
    ["a bare drive letter", "c:main.tex"],
    ["an empty segment", "chapters//intro.tex"],
    ["a trailing slash", "chapters/"],
    ["a dot segment", "./main.tex"],
  ])("rejects %s", (_name, path) => {
    expect(checkHelperPath(path)).toEqual(expect.any(String));
  });

  it("accepts 260 characters and rejects 261", () => {
    expect(checkHelperPath("a".repeat(260))).toBeUndefined();
    expect(checkHelperPath("a".repeat(261))).toEqual(expect.any(String));
  });
});

describe("isHelperProjectId", () => {
  it.each(["thesis", "deep-nets-a-survey", "paper2"])("accepts %s", (id) => {
    expect(isHelperProjectId(id)).toBe(true);
  });

  it.each(["", ".", "..", "a/b", "a\\b", "a\u0000b", " thesis", "-x", "x-", "a--b", "Thesis", "a_b"])("rejects %j", (id) => {
    expect(isHelperProjectId(id)).toBe(false);
  });
});
