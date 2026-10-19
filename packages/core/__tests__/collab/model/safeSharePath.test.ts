/** Verifies which index paths from peers are safe to write below a project folder. */
import { isSafeSharePath } from "../../../src/collab/model/index";

describe("isSafeSharePath", () => {
  it.each(["main.typ", "fig/plot.pdf", "a/b/c.tex", "labshelf.bib", ".labshelf/checklist.json", "notes/.hidden", "dir.d/file", "my.con/x", "console.txt"])(
    "accepts %s", (path) => { expect(isSafeSharePath(path)).toBe(true); });

  it.each([
    "", "/etc/passwd", "\\win", "a\\b", "../x", "a/../x", "a/..", "./x", "a/./b", "a//b", "a/", "a\0b", "C:/x", "c:x", "C:\\x",
    "CON", "con.txt", "a/NUL", "a/com1.log", "LPT9", "aux.tex", "a/prn", "a/name.", "a/name ",
    "labshelf.yaml", ".labshelf/comments.json", ".labshelf/secret.json", ".labshelf",
    "LabShelf.yaml", ".LABSHELF/comments.json", ".Labshelf/x", ".Labshelf/checklist.json",
  ])("rejects %j", (path) => { expect(isSafeSharePath(path)).toBe(false); });

  it("rejects values that are not strings", () => {
    expect(isSafeSharePath(undefined as unknown as string)).toBe(false);
  });
});
