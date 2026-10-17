// Tests the validation of messages coming from the All projects page.
import { parseAllProjectsMessage } from "../../../../src/writing/allProjects/index";

describe("parseAllProjectsMessage", () => {
  it("accepts well-formed messages and trims titles", () => {
    expect(parseAllProjectsMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseAllProjectsMessage({ type: "create", kind: "template" })).toEqual({ type: "create", kind: "template" });
    expect(parseAllProjectsMessage({ type: "rename", id: "p", title: "  New  " })).toEqual({ type: "rename", id: "p", title: "New" });
    expect(parseAllProjectsMessage({ type: "move", id: "p" })).toEqual({ type: "move", id: "p" });
    expect(parseAllProjectsMessage({ type: "move", id: "p", folder: "a/b" })).toEqual({ type: "move", id: "p", folder: "a/b" });
    expect(parseAllProjectsMessage({ type: "trash", id: "p", trashed: true })).toEqual({ type: "trash", id: "p", trashed: true });
    expect(parseAllProjectsMessage({ type: "files", id: "p" })).toEqual({ type: "files", id: "p" });
    expect(parseAllProjectsMessage({ type: "openFile", id: "p", path: "sec/a..b.tex" })).toEqual({ type: "openFile", id: "p", path: "sec/a..b.tex" });
  });

  it("rejects file paths that could leave the project folder", () => {
    for (const path of [undefined, 3, "", "  ", "/etc/passwd", "\\share\\x", "C:/x.tex", "../x.tex", "sec/../../x", "sec\\..\\x", ".."]) {
      expect(parseAllProjectsMessage({ type: "openFile", id: "p", path })).toBeUndefined();
    }
  });

  it("rejects wrong shapes and values", () => {
    for (const raw of [null, "ready", [], {}, { type: "nope" }, { type: "create", kind: "x" }, { type: "open" }, { type: "open", id: 1 },
      { type: "rename", id: "p", title: "  " }, { type: "duplicate", id: "p" }, { type: "move", id: "p", folder: 3 },
      { type: "archive", id: "p", archived: "yes" }, { type: "command", id: "p" }, { type: "files" }]) {
      expect(parseAllProjectsMessage(raw)).toBeUndefined();
    }
  });
});
