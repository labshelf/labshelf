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

  it("accepts the detail pane messages", () => {
    for (const type of ["detail", "build", "preview", "openLog"]) {
      expect(parseAllProjectsMessage({ type, id: "p" })).toEqual({ type, id: "p" });
    }
    expect(parseAllProjectsMessage({ type: "createFile", id: "p", path: "refs/new.bib" })).toEqual({ type: "createFile", id: "p", path: "refs/new.bib" });
    expect(parseAllProjectsMessage({ type: "setTarget", id: "p" })).toEqual({ type: "setTarget", id: "p" });
    expect(parseAllProjectsMessage({ type: "setTarget", id: "p", venue: "ICML", deadline: "2027-02-28" }))
      .toEqual({ type: "setTarget", id: "p", venue: "ICML", deadline: "2027-02-28" });
    expect(parseAllProjectsMessage({ type: "setTarget", id: "p", deadline: "2028-02-29" })).toEqual({ type: "setTarget", id: "p", deadline: "2028-02-29" });
  });

  it("rejects file paths that could leave the project folder", () => {
    for (const path of [undefined, 3, "", "  ", "/etc/passwd", "\\share\\x", "C:/x.tex", "../x.tex", "sec/../../x", "sec\\..\\x", ".."]) {
      expect(parseAllProjectsMessage({ type: "openFile", id: "p", path })).toBeUndefined();
    }
  });

  it("rejects a created file path that could leave the project folder", () => {
    for (const path of [undefined, 3, "", "  ", "../x", "/etc/x", "C:\\x", "a/../b", "a\\..\\b", "a\0b"]) {
      expect(parseAllProjectsMessage({ type: "createFile", id: "p", path })).toBeUndefined();
    }
  });

  it("rejects a target whose deadline is not a real date or whose venue is not a short string", () => {
    for (const deadline of ["2027-02-30", "2027-13-01", "2027-2-3", "27-02-03", "tomorrow", "2027-02-28T10:00", 20270228, ""]) {
      expect(parseAllProjectsMessage({ type: "setTarget", id: "p", deadline })).toBeUndefined();
    }
    for (const venue of [3, "x".repeat(201)]) {
      expect(parseAllProjectsMessage({ type: "setTarget", id: "p", venue })).toBeUndefined();
    }
    expect(parseAllProjectsMessage({ type: "setTarget", id: "p", venue: "x".repeat(200) })).toEqual({ type: "setTarget", id: "p", venue: "x".repeat(200) });
  });

  it("accepts the selected project, or null for none", () => {
    expect(parseAllProjectsMessage({ type: "project.selected", id: "p" })).toEqual({ type: "project.selected", id: "p" });
    expect(parseAllProjectsMessage({ type: "project.selected", id: null })).toEqual({ type: "project.selected", id: null });
    for (const id of [undefined, "", 3]) expect(parseAllProjectsMessage({ type: "project.selected", id })).toBeUndefined();
  });

  it("rejects wrong shapes and values", () => {
    for (const raw of [null, "ready", [], {}, { type: "nope" }, { type: "create", kind: "x" }, { type: "open" }, { type: "open", id: 1 },
      { type: "rename", id: "p", title: "  " }, { type: "duplicate", id: "p" }, { type: "move", id: "p", folder: 3 },
      { type: "archive", id: "p", archived: "yes" }, { type: "command", id: "p" }, { type: "files" }, { type: "detail" }, { type: "build", id: 1 }, { type: "createFile", id: "p" }, { type: "setTarget" }]) {
      expect(parseAllProjectsMessage(raw)).toBeUndefined();
    }
  });
});
