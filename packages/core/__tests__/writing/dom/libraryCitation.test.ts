/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests Cite from Library in the source editor: the popup's footer shows the exact citation of each pick (the paper, a
// page, a selected passage, a highlight, a note), and Insert writes it at the cursor with a scope record whose anchor
// resolves to the inserted command.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation, ItemFile, PaperRecord } from "../../../src/index.js";
import { findCiteKeyOccurrences } from "../../../src/writing/citations/citeKeys.js";
import { createScopedCitation, resolveCitationScope, type CitationScopeRecord } from "../../../src/writing/citations/citationScopes.js";
import { pickLibraryCitation, type CitePick, type CitePickMemory } from "../../../src/writing/dom/sourceEditor/citePickDialog.js";
import { createLibraryCitation, insertScopedCitation, type LibraryCitationDeps } from "../../../src/writing/dom/sourceEditor/libraryCitation.js";
import { mountPaperPages } from "../../../src/writing/dom/sourceEditor/paperPages.js";

jest.mock("../../../src/writing/dom/sourceEditor/paperPages.js", () => ({ mountPaperPages: jest.fn() }));
const mountPages = mountPaperPages as jest.MockedFunction<typeof mountPaperPages>;
type PagesOptions = Parameters<typeof mountPaperPages>[1];

// jsdom has no layout; CodeMirror measures text ranges after an edit.
Range.prototype.getClientRects ??= (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as () => DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const paper = { id: "p1", title: "Attention is all you need", citeKey: "vaswani2017", status: "reading", year: 2017 } as unknown as PaperRecord;
const other = { id: "p2", title: "Deep residual learning", citeKey: "he2016", status: "reading", year: 2016 } as unknown as PaperRecord;
const highlight: Annotation = {
  id: "h1", paperId: "p1", type: "highlight", pageNumber: 4, content: "scaled dot-product attention", createdAt: "2020-01-01", updatedAt: "",
  position: { x: 0.1, y: 0.2, width: 0.5, height: 0.05 },
} as Annotation;
const notes = {
  segments: [
    { kind: "item", id: "n1", body: "My own remark", anchor: { kind: "point", page: 2, x: 0.3, y: 0.4 } },
    { kind: "item", id: "n2", body: "On the highlight", anchor: { kind: "highlight", annotationId: "h1" } },
    { kind: "item", id: "n3", body: "Anchored nowhere", anchor: { kind: "none" } },
  ],
} as unknown as ItemFile;
const lookups = { annotations: [highlight], notes };

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); } };

function deps(format: "latex" | "typst" = "latex"): LibraryCitationDeps {
  return {
    format,
    papers: async () => [paper, other],
    pdfOf: () => ({ kind: "bytes", data: new Uint8Array() }) as never,
    annotationsOf: async (id) => (id === "p1" ? [highlight] : []),
    notesOf: async (id) => (id === "p1" ? notes : undefined),
    saveScope: jest.fn(async () => {}),
    refreshBibliography: jest.fn(async () => {}),
  };
}

let pages: PagesOptions | undefined;
beforeEach(() => {
  pages = undefined;
  mountPages.mockImplementation((container, options) => {
    pages = options;
    const element = document.createElement("div");
    container.append(element);
    return { element, ready: Promise.resolve(5), destroy: jest.fn() };
  });
});
afterEach(() => { document.body.replaceChildren(); });

const preview = (): string => document.querySelector(".ls-cite-pick-preview")!.textContent ?? "";
const button = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>(".rd-cite-dialog button")].find((each) => each.textContent === label)!;
const quoteBox = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".ls-cite-pick-quote input")!;
const quoteShown = (): boolean => !document.querySelector<HTMLElement>(".ls-cite-pick-quote")!.hidden;

async function pickPaper(query: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(".rd-cite-dialog input[role=combobox]")!;
  input.dispatchEvent(new Event("focus"));
  input.value = query;
  input.dispatchEvent(new Event("input"));
  document.querySelector<HTMLElement>(".ls-combobox-option")!.click();
  await flush();
}

describe("pickLibraryCitation", () => {
  it("filters papers by key or year, preselects the whole paper and shows each pick's citation in the footer", async () => {
    const memory: CitePickMemory = {};
    const result = pickLibraryCitation(deps(), memory);
    await flush();
    expect(document.querySelector(".rd-cite-dialog-title")!.textContent).toBe("Cite from Library");
    expect(button("Insert").disabled).toBe(true);
    await pickPaper("@vaswani");
    expect(pages?.annotations).toEqual([highlight]);
    // Pins: a point note at its point, a note on a highlight at the highlight, a note anchored nowhere has none.
    expect(pages?.notes).toEqual([{ id: "n1", page: 2, x: 0.3, y: 0.4 }, { id: "n2", page: 4, x: 0.1, y: 0.2 }]);
    expect(preview()).toBe(createScopedCitation("latex", "vaswani2017", { kind: "paper" }, false, lookups));
    expect(button("Insert").disabled).toBe(false);
    expect(quoteShown()).toBe(false);

    pages!.onPageInView(3);
    button("This page (p. 3)").click();
    expect(preview()).toBe("\\cite[p.~3]{vaswani2017}");
    expect(quoteShown()).toBe(false);

    pages!.onSelection({ page: 2, text: "a fresh passage" });
    expect(preview()).toBe(createScopedCitation("latex", "vaswani2017", { kind: "passage", page: 2, text: "a fresh passage" }, true, lookups));
    expect(quoteShown()).toBe(true);
    expect(quoteBox().checked).toBe(true);

    pages!.onSelection({ page: 4, text: "dot-product", highlightId: "h1" });
    expect(preview()).toBe(createScopedCitation("latex", "vaswani2017", { kind: "highlight", annotationId: "h1", page: 4 }, true, lookups));
    quoteBox().click();
    expect(preview()).toBe("\\cite[p.~4]{vaswani2017}");

    pages!.onHighlightClick("h1");
    expect(quoteBox().checked).toBe(true);
    expect(preview()).toBe(createScopedCitation("latex", "vaswani2017", { kind: "highlight", annotationId: "h1", page: 4 }, true, lookups));

    pages!.onNoteClick("n1");
    expect(quoteShown()).toBe(true);
    expect(quoteBox().checked).toBe(false);
    expect(preview()).toBe("\\cite[p.~2]{vaswani2017}");
    quoteBox().click();
    expect(preview()).toBe(createScopedCitation("latex", "vaswani2017", { kind: "note", noteId: "n1", page: 2 }, true, lookups));

    button("Whole paper").click();
    expect(preview()).toBe("\\cite{vaswani2017}");

    pages!.onNoteClick("n2");
    button("Insert").click();
    await expect(result).resolves.toEqual({
      paper, scope: { kind: "note", noteId: "n2", page: 4 }, quoted: false, text: "\\cite[p.~4]{vaswani2017}",
    } satisfies CitePick);
    expect(memory.paperId).toBe("p1");
  });

  it("opens the paper picked last and finds a paper by its year", async () => {
    const memory: CitePickMemory = { paperId: "p2" };
    const result = pickLibraryCitation(deps("typst"), memory);
    await flush();
    expect(preview()).toBe("@he2016");
    await pickPaper("2017");
    expect(preview()).toBe("@vaswani2017");
    document.querySelector(".rd-cite-dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await expect(result).resolves.toMatchObject({ scope: { kind: "paper" }, text: "@vaswani2017" });
  });

  it("resolves undefined on Cancel", async () => {
    const result = pickLibraryCitation(deps(), {});
    await flush();
    button("Cancel").click();
    await expect(result).resolves.toBeUndefined();
  });
});

function editor(doc: string, from: number, to = from): EditorView {
  return new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: from, head: to } }) });
}

const FIELDS = { id: "r1", file: "chapters/intro.tex", createdAt: "2026-11-10T00:00:00.000Z" };

describe("insertScopedCitation", () => {
  it("replaces the selection and anchors the record to the command, not the quotation before it", () => {
    const view = editor("As shown in OLD the model works.", 12, 15);
    const scope = { kind: "highlight", annotationId: "h1", page: 4 } as const;
    const text = createScopedCitation("latex", "vaswani2017", scope, true, lookups);
    const record = insertScopedCitation(view, "latex", { paper, scope, quoted: true, text }, FIELDS);
    const doc = view.state.doc.toString();
    expect(doc).toBe(`As shown in ${text} the model works.`);
    expect(view.state.selection.main.head).toBe(12 + text.length);
    expect(record.anchor.quote).toBe("\\cite[p.~4]{vaswani2017}");
    expect(record).toMatchObject({ ...FIELDS, key: "vaswani2017", scope });
    const occurrence = findCiteKeyOccurrences("latex", doc).find((cited) => cited.key === "vaswani2017")!;
    expect(resolveCitationScope([record], FIELDS.file, doc, occurrence)?.id).toBe("r1");
  });

  it("anchors a Typst citation with a page at the cursor", () => {
    const view = editor("See  here, and @vaswani2017 later.", 4);
    const scope = { kind: "page", page: 7 } as const;
    const text = createScopedCitation("typst", "vaswani2017", scope, false, lookups);
    const record = insertScopedCitation(view, "typst", { paper, scope, quoted: false, text }, FIELDS);
    const doc = view.state.doc.toString();
    expect(record.anchor.quote).toBe("@vaswani2017[p. 7]");
    const [inserted, later] = findCiteKeyOccurrences("typst", doc).filter((cited) => cited.key === "vaswani2017");
    expect(resolveCitationScope([record], FIELDS.file, doc, inserted!)?.id).toBe("r1");
    expect(resolveCitationScope([record], FIELDS.file, doc, later!)).toBeUndefined();
  });
});

describe("createLibraryCitation", () => {
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as never;

  it("inserts the pick, saves its scope and refreshes the bibliography", async () => {
    const d = deps();
    const cite = createLibraryCitation(d, { file: "main.tex", logger });
    const view = editor("Text .", 5);
    const done = cite(view);
    await flush();
    await pickPaper("he2016");
    button("Insert").click();
    await done;
    expect(view.state.doc.toString()).toBe("Text \\cite{he2016}.");
    const saved = (d.saveScope as jest.Mock).mock.calls[0]![0] as CitationScopeRecord;
    expect(saved).toMatchObject({ file: "main.tex", key: "he2016", scope: { kind: "paper" }, anchor: { quote: "\\cite{he2016}" } });
    expect(saved.id).toMatch(/\S/);
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
    expect(d.refreshBibliography).toHaveBeenCalled();
  });

  it("keeps the citation when saving its scope fails", async () => {
    const d = { ...deps(), saveScope: jest.fn(async () => { throw new Error("disk full"); }) };
    const cite = createLibraryCitation(d, { file: "main.tex", logger });
    const view = editor("", 0);
    const done = cite(view);
    await flush();
    await pickPaper("he2016");
    button("Insert").click();
    await done;
    expect(view.state.doc.toString()).toBe("\\cite{he2016}");
    expect((logger as { log: jest.Mock }).log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.anything());
    expect(d.refreshBibliography).toHaveBeenCalled();
  });
});
