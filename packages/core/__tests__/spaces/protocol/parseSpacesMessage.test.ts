// Tests that the Spaces page parser accepts well-formed messages and rejects unknown types and malformed fields.
import { parseSpacesMessage } from "../../../src/spaces/protocol/index";

describe("parseSpacesMessage", () => {
  it.each([
    [{ type: "ready", view: "catalog" }],
    [{ type: "ready", view: "space", id: "thesis" }],
    [{ type: "createSpace", name: "Thesis" }],
    [{ type: "setPurpose", id: "thesis" }],
    [{ type: "setPurpose", id: "thesis", purpose: "Write it" }],
    [{ type: "addPapers", id: "thesis", paperIds: ["p1", "p2"], folder: "f1" }],
    [{ type: "setFocus", id: "thesis", paperId: "p1", focus: true }],
    [{ type: "moveReference", id: "thesis", paperId: "p1" }],
    [{ type: "createFolder", id: "thesis", name: "Methods", parent: "f1" }],
    [{ type: "addDate", id: "thesis", date: { kind: "task", title: "Draft", date: "2026-11-02", done: false } }],
    [{ type: "updateDate", id: "thesis", dateId: "d1", date: { kind: "read", title: "Read", date: "2026-11-02", paperIds: ["p1"] } }],
    [{ type: "setDone", id: "thesis", dateId: "d1", done: true }],
    [{ type: "addTerm", id: "thesis", term: { term: "ELBO", definition: "Bound", source: { paperId: "p1", page: 3 } } }],
    [{ type: "openSpace", id: "thesis", tab: "glossary" }],
    [{ type: "openSpace", id: "thesis" }],
    [{ type: "openCatalog" }],
    [{ type: "exportIcs", id: "thesis" }],
    [{ type: "listPapers" }],
    [{ type: "listProjects" }],
  ])("accepts %j", (raw) => {
    expect(parseSpacesMessage(raw)).toEqual(raw);
  });

  it("keeps only the known fields of a date draft", () => {
    const raw = { type: "addDate", id: "s", date: { kind: "deadline", title: "Due", date: "2026-11-02", evil: 1 }, extra: true };
    expect(parseSpacesMessage(raw)).toEqual({ type: "addDate", id: "s", date: { kind: "deadline", title: "Due", date: "2026-11-02" } });
  });

  it.each([
    ["a non-object", "ready"],
    ["an array", [{ type: "ready" }]],
    ["null", null],
    ["an unknown type", { type: "dropTables", id: "s" }],
    ["a ready without a view", { type: "ready" }],
    ["a ready with an unknown view", { type: "ready", view: "settings" }],
    ["a space view without an id", { type: "ready", view: "space" }],
    ["an empty Space name", { type: "createSpace", name: "  " }],
    ["a missing Space id", { type: "renameSpace", name: "X" }],
    ["an empty Space id", { type: "deleteSpace", id: "" }],
    ["a non-string purpose", { type: "setPurpose", id: "s", purpose: 3 }],
    ["paper ids that are not strings", { type: "addPapers", id: "s", paperIds: ["p1", 2] }],
    ["no paper ids", { type: "addPapers", id: "s", paperIds: [] }],
    ["a non-boolean focus", { type: "setFocus", id: "s", paperId: "p1", focus: "yes" }],
    ["an empty folder", { type: "moveReference", id: "s", paperId: "p1", folder: "" }],
    ["an unknown date kind", { type: "addDate", id: "s", date: { kind: "party", title: "T", date: "2026-11-02" } }],
    ["an impossible date", { type: "addDate", id: "s", date: { kind: "deadline", title: "T", date: "2026-02-30" } }],
    ["a task without done", { type: "addDate", id: "s", date: { kind: "task", title: "T", date: "2026-11-02" } }],
    ["a date without a title", { type: "addDate", id: "s", date: { kind: "deadline", date: "2026-11-02" } }],
    ["read paper ids that are not a list", { type: "addDate", id: "s", date: { kind: "read", title: "T", date: "2026-11-02", paperIds: "p1" } }],
    ["a date update without a date id", { type: "updateDate", id: "s", date: { kind: "deadline", title: "T", date: "2026-11-02" } }],
    ["a term without a definition", { type: "addTerm", id: "s", term: { term: "ELBO" } }],
    ["a term source page of 0", { type: "addTerm", id: "s", term: { term: "E", definition: "D", source: { paperId: "p1", page: 0 } } }],
    ["a non-boolean done", { type: "setDone", id: "s", dateId: "d1", done: 1 }],
    ["an unknown tab", { type: "openSpace", id: "s", tab: "settings" }],
    ["an openPaper without a paper id", { type: "openPaper" }],
  ])("rejects %s", (_name, raw) => {
    expect(parseSpacesMessage(raw)).toBeUndefined();
  });
});
