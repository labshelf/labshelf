// Pins the tab registry: ids built from a kind and its params read back to the same kind and params.
import { TAB_KINDS, parseTab } from "../../../src/libraryUi/editorArea";

describe("tab kinds", () => {
  it("gives the single-instance kinds their kind as id", () => {
    expect(TAB_KINDS.library.id({})).toBe("library");
    expect(parseTab("all-projects")).toEqual({ kind: "all-projects", params: {} });
  });

  it("round-trips a source tab id whose path holds separators", () => {
    const params = { projectId: "th:esis", path: "chapters/intro, part 1.tex" };
    const id = TAB_KINDS.source.id(params);
    expect(parseTab(id)).toEqual({ kind: "source", params });
    expect(TAB_KINDS.source.title(params)).toBe("intro, part 1.tex");
  });

  it("round-trips a Space inner tab", () => {
    const params = { id: "reading:group", tab: "glossary" };
    expect(parseTab(TAB_KINDS.space.id(params))).toEqual({ kind: "space", params });
    expect(parseTab(TAB_KINDS.spaces.id({}))).toEqual({ kind: "spaces", params: {} });
  });

  it("round-trips a comments tab id by project", () => {
    const params = { projectId: "thesis" };
    expect(parseTab(TAB_KINDS.comments.id(params))).toEqual({ kind: "comments", params });
  });

  it("round-trips a history tab id by project", () => {
    const params = { projectId: "thesis" };
    expect(parseTab(TAB_KINDS.history.id(params))).toEqual({ kind: "history", params });
    expect(TAB_KINDS.history.title(params)).toBe("History");
  });

  it("round-trips a search tab id by project", () => {
    const params = { projectId: "thesis" };
    expect(parseTab(TAB_KINDS.search.id(params))).toEqual({ kind: "search", params });
    expect(TAB_KINDS.search.title(params)).toBe("Search");
  });

  it("returns null for an unknown kind or a wrong number of params", () => {
    expect(parseTab("editor")).toBeNull();
    expect(parseTab("preview")).toBeNull();
    expect(parseTab("library:x")).toBeNull();
  });

  it("loads each kind's body as a module with mountTab", async () => {
    for (const kind of Object.values(TAB_KINDS)) expect(typeof (await kind.load()).mountTab).toBe("function");
  });
});
