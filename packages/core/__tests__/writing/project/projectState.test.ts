/** Verifies parsing, validation and editing of a project's state file. */
import {
  cursorOf, newestCursor, parseProjectState, serializeProjectState, withCursor,
} from "../../../src/writing/project/projectState";

const cursor = { file: "sec/intro.tex", line: 12, character: 4, updatedAt: "2026-01-02T10:00:00.000Z" };

describe("parseProjectState", () => {
  it("reads a JSON object and rejects anything else", () => {
    expect(parseProjectState('{"file":"a.tex"}')).toEqual({ file: "a.tex" });
    for (const text of ["[]", "null", "3", "{oops", ""]) { expect(parseProjectState(text)).toBeUndefined(); }
  });
});

describe("cursorOf", () => {
  it("reads a complete cursor", () => {
    expect(cursorOf({ ...cursor, extra: 1 })).toEqual(cursor);
  });

  it("rejects missing keys, bad numbers and a bad date", () => {
    expect(cursorOf({ ...cursor, file: undefined })).toBeUndefined();
    expect(cursorOf({ ...cursor, line: -1 })).toBeUndefined();
    expect(cursorOf({ ...cursor, character: 1.5 })).toBeUndefined();
    expect(cursorOf({ ...cursor, updatedAt: "soon" })).toBeUndefined();
  });

  it("rejects files that leave the project folder", () => {
    for (const file of ["../x.tex", "a/../../x.tex", "/etc/passwd", "C:/x.tex", "a\\b.tex", "", "a//b.tex"]) {
      expect(cursorOf({ ...cursor, file })).toBeUndefined();
    }
  });
});

describe("withCursor", () => {
  it("keeps unknown keys and replaces the four cursor keys", () => {
    const next = withCursor({ file: "old.tex", line: 1, character: 1, updatedAt: "x", theme: "dark" }, cursor);
    expect(next).toEqual({ ...cursor, theme: "dark" });
    expect(serializeProjectState(next).endsWith("}\n")).toBe(true);
  });
});

describe("newestCursor", () => {
  it("picks the newest instant and tolerates an empty list", () => {
    const old = { id: "a", cursor: { ...cursor, updatedAt: "2026-01-01T00:00:00.000Z" } };
    const recent = { id: "b", cursor };
    expect(newestCursor([old, recent])?.id).toBe("b");
    expect(newestCursor([])).toBeUndefined();
  });
});
