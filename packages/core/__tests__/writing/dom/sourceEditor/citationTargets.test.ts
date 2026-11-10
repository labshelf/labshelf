/** @jest-environment jsdom */
import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation, ItemFile, PaperRecord } from "../../../../src/index.js";
import { createCiteTargetCompletion, createPageArgumentCompletion } from "../../../../src/writing/dom/sourceEditor/citationTargets.js";
import { createCitationHoverSource, deriveCitationHoverContent, renderCitationHover } from "../../../../src/writing/dom/sourceEditor/citationHover.js";

// jsdom has no layout; CodeMirror measures text ranges after an edit.
Range.prototype.getClientRects ??= (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as () => DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const paper = { id: "p1", title: "Attention Is All You Need", citeKey: "smith", status: "reading", authors: ["A. Smith"], year: 2020, journal: "NeurIPS", summary: "x".repeat(300), path: "papers/p1" } as unknown as PaperRecord;

const highlight = (id: string, pageNumber: number, content: string): Annotation => ({
  id, paperId: "p1", type: "highlight", pageNumber, content, createdAt: `2020-01-0${pageNumber}`, updatedAt: "",
});
const annotations = [highlight("a", 4, "first quote"), highlight("b", 9, "second quote")];
const notes = { segments: [{ kind: "item", body: "Remember this\nmore", anchor: { kind: "point", page: 5 } }, { kind: "item", body: "Another", anchor: { kind: "none" } }] } as unknown as ItemFile;

const deps = (format: "latex" | "typst") => ({
  format, papers: async () => [paper], highlightsOf: async () => annotations, notes: { read: async () => notes },
});

const views: EditorView[] = [];
function open(doc: string, marker: string): { view: EditorView; pos: number } {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc }) });
  views.push(view);
  return { view, pos: doc.indexOf(marker) + marker.length };
}
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.innerHTML = ""; });

const labels = (result: CompletionResult | null): string[] => result?.options.map((option) => option.label) ?? [];
const pick = (result: CompletionResult | null, view: EditorView, label: string): void => {
  const option = result!.options.find((candidate) => candidate.label.startsWith(label))!;
  (option.apply as Exclude<Completion["apply"], string | undefined>as (v: EditorView, c: Completion, f: number, t: number) => void)(view, option, result!.from, result!.to ?? view.state.selection.main.head);
};

describe("targets of the cited key", () => {
  it("lists the paper's targets on explicit completion only", async () => {
    const { view, pos } = open("See \\citep{smith}.", "smith");
    const source = createCiteTargetCompletion(deps("latex"));
    expect(await source(new CompletionContext(view.state, pos, false))).toBeNull();
    const result = await source(new CompletionContext(view.state, pos, true));
    expect(labels(result).slice(0, 2)).toEqual(["Whole paper", "Page…"]);
    expect(labels(result)).toEqual(expect.arrayContaining(["Page p. 4 — first quote", "Note p. 5 — Remember this", "Note — Another"]));
    expect(result?.from).toBe(4);
  });

  it("offers nothing for a key outside the library or with several keys", async () => {
    const source = createCiteTargetCompletion(deps("latex"));
    const unknown = open("\\cite{other}", "other");
    expect(await source(new CompletionContext(unknown.view.state, unknown.pos, true))).toBeNull();
    const several = open("\\cite{a, smith}", "smith");
    expect(await source(new CompletionContext(several.view.state, several.pos, true))).toBeNull();
  });

  it("writes a page target with the cursor where the page goes", async () => {
    const { view, pos } = open("See \\citep{smith}.", "smith");
    pick(await createCiteTargetCompletion(deps("latex"))(new CompletionContext(view.state, pos, true)), view, "Page…");
    expect(view.state.doc.toString()).toBe("See \\citep[p.~]{smith}.");
    expect(view.state.selection.main.head).toBe("See \\citep[p.~".length);
  });

  it("writes a highlight with its quotation before the citation", async () => {
    const { view, pos } = open("See \\citep{smith}.", "smith");
    const result = await createCiteTargetCompletion(deps("latex"))(new CompletionContext(view.state, pos, true));
    const quoted = result!.options.find((option) => option.label.startsWith("Quote p. 9") && option.detail?.includes("quotation"))!;
    expect(quoted).toBeDefined();
    pick({ ...result!, options: [quoted] }, view, "Quote p. 9");
    expect(view.state.doc.toString()).toBe("See ``second quote''~\\citep[p.~9]{smith}.");
  });

  it("completes a Typst reference", async () => {
    const { view, pos } = open("See @smith here", "smith");
    const result = await createCiteTargetCompletion(deps("typst"))(new CompletionContext(view.state, pos, true));
    pick(result, view, "Page p. 4");
    expect(view.state.doc.toString()).toBe("See @smith[p. 4] here");
  });
});

describe("page argument", () => {
  it("offers the paper's highlights and notes with a page", async () => {
    const { view, pos } = open("\\cite[]{smith}", "[");
    const result = await createPageArgumentCompletion(deps("latex"))(new CompletionContext(view.state, pos, false));
    expect(labels(result)).toEqual(["Page p. 4 — first quote", "Quote p. 4 — first quote", "Note p. 5 — Remember this", "Note text p. 5 — Remember this", "Page p. 9 — second quote", "Quote p. 9 — second quote"]);
    pick({ ...result!, options: [result!.options[1]!] }, view, "Quote p. 4");
    expect(view.state.doc.toString()).toBe("``first quote''~\\cite[p.~4]{smith}");
  });

  it("replaces only the typed page in a Typst supplement", async () => {
    const { view, pos } = open("@smith[p]", "[p");
    const result = await createPageArgumentCompletion(deps("typst"))(new CompletionContext(view.state, pos, false));
    pick(result, view, "Note p. 5");
    expect(view.state.doc.toString()).toBe("@smith[p. 5]");
  });

  it("answers nothing outside a page argument or for an unknown key", async () => {
    const source = createPageArgumentCompletion(deps("latex"));
    const plain = open("\\cite{smith}", "smith");
    expect(await source(new CompletionContext(plain.view.state, plain.pos, true))).toBeNull();
    const unknown = open("\\cite[]{other}", "[");
    expect(await source(new CompletionContext(unknown.view.state, unknown.pos, true))).toBeNull();
  });
});

describe("citation hover", () => {
  it("derives the content with the cited page's highlights first", () => {
    const content = deriveCitationHoverContent(paper, annotations, notes, 9);
    expect(content).toMatchObject({ title: paper.title, byline: "A. Smith · 2020", meta: "NeurIPS · Reading", highlightsLabel: "Your highlights on p. 9", notes: ["Another", "Remember this"] });
    expect(content.highlights.map((item) => item.page)).toEqual([9, 4]);
    expect(content.summary.length).toBeLessThanOrEqual(201);
  });

  it("renders the buttons for the deps it has", () => {
    const opened: unknown[] = [];
    const dom = renderCitationHover(paper, deriveCitationHoverContent(paper, annotations, notes, 4), { openPaper: (...args) => opened.push(args), openNotes: (id) => opened.push(id) });
    const buttons = [...dom.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Open at p. 4", "Open notes"]);
    buttons.forEach((button) => button.click());
    expect(opened).toEqual([["p1", 4], "p1"]);
    expect(renderCitationHover(paper, deriveCitationHoverContent(paper, [], undefined), {}).querySelector("button")).toBeNull();
  });

  it("answers on a library key with its page, and not elsewhere", async () => {
    const latex = open("See \\citep[p.~9]{smith} and \\cite{other}.", "{smith");
    const source = createCitationHoverSource({ ...deps("latex") });
    const tooltip = await source(latex.view, latex.pos - 2);
    expect(tooltip?.pos).toBe(latex.pos - 5);
    expect(tooltip?.create(latex.view).dom.textContent).toContain("Your highlights on p. 9");
    expect(await source(latex.view, latex.view.state.doc.toString().indexOf("other"))).toBeNull();
    const typst = open("See @smith[p. 4] here", "@smi");
    const card = await createCitationHoverSource(deps("typst"))(typst.view, typst.pos);
    expect(card?.create(typst.view).dom.textContent).toContain("Your highlights on p. 4");
  });
});
