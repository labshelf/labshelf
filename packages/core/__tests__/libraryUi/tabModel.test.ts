// Pins the tab kinds: ids built from a kind and its params read back to the same kind and params, and a folder round-trips through its URL hash.
import { TAB_KIND_SPECS, createFolderHash, createFolderTitle, parseFolderHash, parseTab } from "../../src/libraryUi/index.js";

describe("tab kinds", () => {
  it("gives the single-instance kinds their kind as id", () => {
    expect(TAB_KIND_SPECS.library.id({})).toBe("library");
    expect(parseTab("all-projects")).toEqual({ kind: "all-projects", params: {} });
  });

  it("round-trips a source tab id whose path holds separators", () => {
    const params = { projectId: "th:esis", path: "chapters/intro, part 1.tex" };
    const id = TAB_KIND_SPECS.source.id(params);
    expect(parseTab(id)).toEqual({ kind: "source", params });
    expect(TAB_KIND_SPECS.source.title(params)).toBe("intro, part 1.tex");
  });

  it("round-trips a Space inner tab", () => {
    const params = { id: "reading:group", tab: "glossary" };
    expect(parseTab(TAB_KIND_SPECS.space.id(params))).toEqual({ kind: "space", params });
    expect(parseTab(TAB_KIND_SPECS.spaces.id({}))).toEqual({ kind: "spaces", params: {} });
  });

  it("round-trips a comments tab id by project", () => {
    const params = { projectId: "thesis" };
    expect(parseTab(TAB_KIND_SPECS.comments.id(params))).toEqual({ kind: "comments", params });
  });

  it("round-trips a history tab id by project", () => {
    const params = { projectId: "thesis" };
    expect(parseTab(TAB_KIND_SPECS.history.id(params))).toEqual({ kind: "history", params });
    expect(TAB_KIND_SPECS.history.title(params)).toBe("History");
  });

  it("round-trips a search tab id by project", () => {
    const params = { projectId: "thesis" };
    expect(parseTab(TAB_KIND_SPECS.search.id(params))).toEqual({ kind: "search", params });
    expect(TAB_KIND_SPECS.search.title(params)).toBe("Search");
  });

  it("returns null for an unknown kind or a wrong number of params", () => {
    expect(parseTab("editor")).toBeNull();
    expect(parseTab("preview")).toBeNull();
    expect(parseTab("library:x")).toBeNull();
  });
});

describe("folder hash", () => {
  it("round-trips folders, encoding each segment", () => {
    for (const f of ["papers", "papers/A", "papers/Reading group/Refs & notes"]) {
      expect(parseFolderHash(createFolderHash(f))).toBe(f);
    }
    expect(createFolderHash("papers/Reading group")).toBe("#/papers/Reading%20group");
  });
  it("falls back to the root for empty, foreign or traversal hashes", () => {
    for (const h of ["", "#", "#/", "#/elsewhere", "#/papers-old/x", "#/papers/../x", "#/papers//x", "#/papers/./x", "#/papers/a%5Cb"]) {
      expect(parseFolderHash(h)).toBe("papers");
    }
  });
  it("tolerates a trailing slash", () => {
    expect(parseFolderHash("#/papers/A/")).toBe("papers/A");
  });
  it("titles the page by the open folder", () => {
    expect(createFolderTitle("papers")).toBe("LabShelf");
    expect(createFolderTitle("papers/ml/Refs")).toBe("Refs — LabShelf");
  });
});
