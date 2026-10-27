/** Pins the LibraryPath and ProjectPath guards, including every input the old per-module validators disagreed on. */
import { isLibraryPath, isProjectPath } from "../../src/path/index";
import { parseUiMessage } from "../../src/libraryUi/protocol/index";
import { parseAllProjectsMessage } from "../../src/writing/allProjects/protocol";
import { parseHistoryLine } from "../../src/writing/history/index";

const NUL = "a\u0000b";
const REJECTED = ["papers\\x", "papers/../x", "/a", "C:/a", "C:a", "a//b", "./a", "a/./b", NUL, "a\\b", ""];

describe("isLibraryPath", () => {
  it.each(["papers", "papers/a/b"])("accepts %j", (path) => {
    expect(isLibraryPath(path)).toBe(true);
  });

  it.each([...REJECTED, "papers/", "papers//a", "docs", "paperz/a", "a/b.tex"])("rejects %j", (path) => {
    expect(isLibraryPath(path)).toBe(false);
  });

  it("rejects a value that is not a string", () => {
    expect(isLibraryPath(42)).toBe(false);
  });
});

describe("isProjectPath", () => {
  it.each(["a/b.tex", "papers", "papers/a/b"])("accepts %j", (path) => {
    expect(isProjectPath(path)).toBe(true);
  });

  it.each(REJECTED)("rejects %j", (path) => {
    expect(isProjectPath(path)).toBe(false);
  });

  it("rejects a value that is not a string", () => {
    expect(isProjectPath(undefined)).toBe(false);
  });
});

// The library UI message guard rejects every unsafe project path, drive letters and control characters included.
describe("parseUiMessage project.openSource", () => {
  const open = (file: string) => parseUiMessage({ type: "project.openSource", project: "p", file, line: 0 });

  it("accepts a path below the project", () => {
    expect(open("a/b.tex")).not.toBeNull();
  });

  it.each(REJECTED)("rejects %j", (file) => {
    expect(open(file)).toBeNull();
  });
});

// The All projects message guard rejects every unsafe project path, backslashes and empty or "." segments included.
describe("parseAllProjectsMessage openFile", () => {
  const open = (path: string) => parseAllProjectsMessage({ type: "openFile", id: "p", path });

  it("accepts a path below the project", () => {
    expect(open("a/b.tex")).toEqual({ type: "openFile", id: "p", path: "a/b.tex" });
  });

  it.each([...REJECTED, "   "])("rejects %j", (path) => {
    expect(open(path)).toBeUndefined();
  });
});

// The history line parser drops files whose path is unsafe, backslashes and control characters included.
describe("parseHistoryLine files", () => {
  const HASH = "0".repeat(64);
  const line = (path: string) => JSON.stringify({ id: "1", at: "2026-01-01T00:00:00.000Z", kind: "edit", files: { [path]: HASH } });

  it("accepts a path below the project", () => {
    expect(parseHistoryLine(line("a/b.tex"))).toBeDefined();
  });

  it.each(REJECTED)("rejects %j", (path) => {
    expect(parseHistoryLine(line(path))).toBeUndefined();
  });
});
