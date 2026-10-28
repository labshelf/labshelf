/**
 * @jest-environment jsdom
 */
// Tests the detail pane through the mounted library UI: head, host data, Cited in, tabs, multi-selection, and the note editor's autosave.
import type { Annotation } from "@labshelf/core";
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";
import { createNoteEditor } from "../../../../src/libraryUi/dom/detailPane/paneState";

const library = [
  paper("a", "papers", {
    title: "Attention", authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, journal: "NeurIPS", tags: ["nlp"], note: "",
    doi: "10.1/x", summary: "Transformers.",
  }),
  paper("b", "papers/B", { title: "Follow-up", authors: ["Vaswani, A."], year: 2019, tags: ["NLP"] }),
];

function annotation(id: string, page: number, content: string, type: Annotation["type"] = "highlight"): Annotation {
  return { id, paperId: "a", type, pageNumber: page, content, color: "yellow", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
}

function showA(prefs = {}) {
  const t = mountForTest(prefs, ALL_CAPABILITIES);
  t.snapshot(library, ["papers/a"], [{ name: "B", path: "papers/B", children: [] }], { a: { annotations: 2, lastPage: 4 } });
  t.host.post({ type: "select", id: "a" });
  return t;
}

describe("detail pane head", () => {
  it("continues at the last page and searches an author by family name", () => {
    const t = showA();
    expect(t.detail().querySelector(".open-btn")?.textContent).toBe("Continue · p. 4");
    t.click('[data-action="searchAuthor"]', t.detail());
    expect(t.lib.store.get().query).toBe("author:vaswani");
  });

  it("removes a tag with its x and keeps the others", () => {
    const t = showA();
    t.click('[data-action="removeTag"][data-tag="nlp"]', t.detail());
    expect(t.sent).toContainEqual({ type: "paper.setTags", ids: ["a"], add: [], remove: ["nlp"] });
  });
});

describe("detail data from the host", () => {
  it("asks for a paper's details when it is shown, and again when its sidecar changes", () => {
    const t = showA();
    expect(t.sent.filter((m) => m.type === "paper.details")).toEqual([{ type: "paper.details", id: "a" }]);
    t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: { size: 2_500_000, relPath: "a/paper.pdf" } } });
    expect(t.detail().textContent).toContain("2.4 MB");
    t.host.post({ type: "sidecarChanged", id: "a" });
    expect(t.sent.filter((m) => m.type === "paper.details")).toHaveLength(2);
  });
});

describe("cited in", () => {
  it("lists the projects citing the paper and opens the source at the line", () => {
    const t = showA();
    const citedIn = [{ project: "thesis", file: "ch/related.tex", line: 11, section: "Related work" }];
    t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, citedIn } });
    const row = t.detail().querySelector<HTMLElement>('[data-action="openSource"]')!;
    expect(row.textContent).toContain("thesis");
    expect(row.textContent).toContain("Related work");
    expect(row.textContent).toContain("ch/related.tex:12");
    t.click('[data-action="openSource"]', t.detail());
    expect(t.sent).toContainEqual({ type: "project.openSource", project: "thesis", file: "ch/related.tex", line: 11 });
  });

  it("shows no section when the host sends no projects", () => {
    const t = showA();
    t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null } });
    expect(t.detail().textContent).not.toContain("Cited in");
  });
});

describe("detail tabs", () => {
  it("lists annotations by page and copies them as the core Markdown", () => {
    const t = showA({ detailTab: "annotations" });
    t.host.post({ type: "details", id: "a", details: { annotations: [annotation("2", 5, "later"), annotation("1", 2, "first")], reading: null, pdf: null } });
    expect([...t.detail().querySelectorAll(".ann-page")].map((e) => e.textContent)).toEqual(["Page 2", "Page 5"]);
    t.click('[data-action="copyAnnotations"]', t.detail());
    const copy = t.sent.at(-1) as { text: string; label: string };
    expect(copy.label).toBe("2 annotations");
    expect(copy.text).toContain("Vaswani & Shazeer, 2017 · `@key-a`");
    expect(copy.text).toContain("## Page 2\n\n> first");
    t.click('.ann-card[data-page="5"]', t.detail());
    expect(t.sent.at(-1)).toEqual({ type: "paper.open", id: "a", page: 5 });
  });

  it("saves the note after a pause and keeps the field while typing", () => {
    jest.useFakeTimers();
    try {
      const t = showA({ detailTab: "notes" });
      const note = t.detail().querySelector<HTMLTextAreaElement>(".note-input")!;
      note.focus();
      note.value = "Key idea";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      expect(t.detail().querySelector(".note-state")?.textContent).toBe("Editing…");
      jest.advanceTimersByTime(700);
      expect(t.sent).toContainEqual({ type: "paper.setNote", id: "a", note: "Key idea" });
      expect(t.detail().querySelector(".note-input")).toBe(note);
    } finally {
      jest.useRealTimers();
    }
  });

  it("finds related papers by the same author and shared tags across folders, and reveals one", () => {
    const t = showA({ detailTab: "related" });
    expect(t.sent).toContainEqual({ type: "paper.similar", id: "a" });
    t.host.post({ type: "similar", id: "a", items: [] });
    const titles = [...t.detail().querySelectorAll(".sec-title")].map((e) => e.textContent);
    expect(titles).toEqual(["Same authors", "Shared tags & keywords"]);
    t.click('.rel-row[data-id="b"]', t.detail());
    expect(t.lib.store.get().folder).toBe("papers");
    expect([...t.lib.store.get().selected]).toEqual(["b"]);
    t.lib.store.openFolder("papers/B");
    t.lib.store.selectOnly("b");
    t.click('.rel-row[data-id="a"]', t.detail());
    expect(t.lib.store.get().folder).toBe("papers");
    expect([...t.lib.store.get().selected]).toEqual(["a"]);
  });

  it("formats the citation in the chosen style and remembers it", () => {
    const t = showA();
    t.click('[data-action="citeFormat"][data-format="apa"]', t.detail());
    expect(t.saved).toContainEqual({ citeFormat: "apa" });
    expect(t.detail().querySelector(".cite-box")?.textContent).toBe("Vaswani, A., & Shazeer, N. (2017). Attention. NeurIPS. https://doi.org/10.1/x");
    t.click('.row-end [data-action="copyCite"]', t.detail());
    expect(t.sent.at(-1)).toMatchObject({ type: "clipboard.write", label: "APA reference" });
  });
});

describe("multi-selection", () => {
  it("shows the common tags and the selected papers", () => {
    const t = showA();
    t.lib.store.set({ selected: new Set(["a", "b"]) });
    expect(t.detail().querySelector(".detail-title")?.textContent).toBe("2 papers selected");
    expect([...t.detail().querySelectorAll(".tag-name")].map((e) => e.textContent)).toEqual(["nlp"]);
    expect(t.detail().querySelectorAll(".sel-list .rel-row")).toHaveLength(2);
  });

  it("labels the status button Status when the selected papers differ, and with the shared status when they agree", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    const mixed = [paper("a", "papers", { status: "reading" }), paper("b", "papers", { status: "done" })];
    t.snapshot(mixed, ["papers/a"], [], {});
    t.lib.store.set({ selected: new Set(["a", "b"]) });
    expect(t.detail().querySelector(".status-btn")?.textContent).toContain("Status");
    t.snapshot([paper("a", "papers", { status: "done" }), paper("b", "papers", { status: "done" })], ["papers/a"], [], {});
    t.lib.store.set({ selected: new Set(["a", "b"]) });
    expect(t.detail().querySelector(".status-btn")?.textContent).toContain("Done");
  });
});

function setup() {
  const post = jest.fn();
  const applyNote = jest.fn();
  const ctx = { store: { applyNote }, transport: { post } };
  const editor = createNoteEditor(ctx as never, document.createElement("div"));
  return { editor, post };
}

describe("note editor autosave", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("posts the latest draft once after rapid changes", () => {
    const { editor, post } = setup();
    for (const text of ["a", "ab", "abc"]) { editor.changed("p1", text); }
    expect(post).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "paper.setNote", id: "p1", note: "abc" });
  });

  it("does not post a second time after a flush", () => {
    const { editor, post } = setup();
    editor.changed("p1", "x");
    editor.flush();
    jest.advanceTimersByTime(5000);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
