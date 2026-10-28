/** Pins isInside: the one containment test, with "/" paths and with Windows paths. */
import path from "node:path";
import { isInside, posixPathOps } from "../../src/path/index";

describe("isInside with posix paths", () => {
  it.each([
    ["/proj", "/proj/a.tex", true],
    ["/proj", "/proj/sub/deep/a.tex", true],
    ["/proj", "/proj/..notes", true],
    ["/proj/", "/proj/a.tex", true],
    ["/proj", "/other/a.tex", false],
    ["/proj", "/projx/a.tex", false],
    ["/proj/sub", "/proj", false],
    ["/proj/sub", "/proj/x", false],
  ])("isInside(%j, %j) is %j", (folder, file, expected) => {
    expect(isInside(posixPathOps, folder, file)).toBe(expected);
  });

  it("treats the folder itself as outside unless allowEqual is set", () => {
    expect(isInside(posixPathOps, "/proj", "/proj")).toBe(false);
    expect(isInside(posixPathOps, "/proj/", "/proj")).toBe(false);
    expect(isInside(posixPathOps, "/proj", "/proj", { allowEqual: true })).toBe(true);
  });

  it("does not let allowEqual widen anything else", () => {
    expect(isInside(posixPathOps, "/proj/sub", "/proj", { allowEqual: true })).toBe(false);
    expect(isInside(posixPathOps, "/proj", "/proj/a", { allowEqual: true })).toBe(true);
  });
});

describe("isInside with Windows paths", () => {
  it.each([
    ["C:\\proj", "C:\\proj\\a.typ", true],
    ["C:\\proj", "C:\\proj\\sub\\a.typ", true],
    ["C:\\proj", "C:\\proj\\..notes", true],
    ["C:\\proj\\", "C:\\proj\\a.typ", true],
    ["C:\\proj", "D:\\x", false],
    ["C:\\proj", "D:\\proj\\a.typ", false],
    ["C:\\proj\\sub", "C:\\proj", false],
    ["C:\\proj\\sub", "C:\\proj\\x", false],
  ])("isInside(%j, %j) is %j", (folder, file, expected) => {
    expect(isInside(path.win32, folder, file)).toBe(expected);
  });

  it("follows path.win32.relative on drive-letter case", () => {
    const expected = path.win32.relative("C:\\proj", "c:\\proj\\a.typ") === "a.typ";
    expect(isInside(path.win32, "C:\\proj", "c:\\proj\\a.typ")).toBe(expected);
  });

  it("treats the folder itself as outside unless allowEqual is set", () => {
    expect(isInside(path.win32, "C:\\proj", "C:\\proj")).toBe(false);
    expect(isInside(path.win32, "C:\\proj", "C:\\proj", { allowEqual: true })).toBe(true);
  });
});
