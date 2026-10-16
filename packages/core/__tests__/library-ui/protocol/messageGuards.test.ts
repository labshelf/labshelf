import { isLibraryPath, parseUiMessage } from "../../../src/library-ui/protocol";

describe("isLibraryPath", () => {
  it("accepts papers and the folders below it", () => {
    expect(isLibraryPath("papers")).toBe(true);
    expect(isLibraryPath("papers/Reading group/2024")).toBe(true);
  });

  it("rejects anything that could leave papers", () => {
    for (const bad of ["", "/etc", "papers/../secrets", "papers/./A", "papers//A", "papers/A/", "other/A", "papers\\A", 7, null]) {
      expect(isLibraryPath(bad)).toBe(false);
    }
  });
});

describe("parseUiMessage", () => {
  it("passes every well-formed message through", () => {
    const messages = [
      { type: "ready" },
      { type: "navigate", folder: "papers/A" },
      { type: "paper.open", id: "p1" },
      { type: "paper.open", id: "p1", page: 3 },
      { type: "paper.setStatus", ids: ["p1", "p2"], status: "done" },
      { type: "paper.setTags", ids: ["p1"], add: ["nlp"], remove: [] },
      { type: "paper.setNote", id: "p1", note: "" },
      { type: "paper.move", ids: ["p1"], target: "papers/B" },
      { type: "paper.makeSearchable", ids: ["p1"] },
      { type: "clipboard.write", text: "key", label: "cite key" },
      { type: "folder.create", parent: "papers", name: "New" },
      { type: "project.openSource", project: "thesis", file: "ch/one.tex", line: 0 },
    ];
    for (const m of messages) expect(parseUiMessage(m)).toEqual(m);
  });

  it("refuses unknown types, missing or mistyped fields and paths outside papers", () => {
    const bad = [
      null, "ready", [], { type: "toString" }, { type: "nope" },
      { type: "navigate", folder: "/etc" },
      { type: "paper.move", ids: ["p1"], target: "papers/../.." },
      { type: "paper.move", ids: ["p1", 7], target: "papers/A" },
      { type: "paper.setStatus", ids: ["p1"], status: "archived" },
      { type: "paper.open", id: "p1", page: 0 },
      { type: "paper.open", id: "" },
      { type: "paper.setNote", id: "p1" },
      { type: "clipboard.write", text: 3 },
      { type: "project.openSource", project: "thesis", file: "../x.tex", line: 0 },
      { type: "project.openSource", project: "thesis", file: "/etc/x.tex", line: 0 },
      { type: "project.openSource", project: "thesis", file: "a\\b.tex", line: 0 },
      { type: "project.openSource", project: "thesis", file: "a.tex", line: -1 },
    ];
    for (const m of bad) expect(parseUiMessage(m)).toBeNull();
  });
});
