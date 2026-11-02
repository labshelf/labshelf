/** @jest-environment jsdom */
/**
 * Tests folding (D8) through foldPlugin and setFold on a view with the code cell and output node views: a collapsed cell gets qmd-collapsed and a .qmd-cell-summary line, its outputs
 * get qmd-collapsed-output, a collapsed section hides every block up to the next heading of the same or a higher level through qmd-in-collapsed-section, and a fold change never changes the document
 * or enters the undo history. The CSS that hides the classes is not loaded in jsdom, so hiding is tested as the classes.
 *
 * The view is built here with the node views and the plugin, not through mountQmdEditor, because the editor handle does not expose its EditorView and setFold needs one.
 * That createPlugins registers foldPlugin is not tested for the same reason.
 */
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, TextSelection, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { cascadeStalePlugin } from "../../../src/qmd/dom/cascadeStale";
import { foldPlugin, foldStateOf, setFold } from "../../../src/qmd/dom/foldPlugin";
import { sectionKey } from "../../../src/qmd/dom/notebookCells";
import { until, settle } from "../../support/nodeViewHarness";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const RAN = "2026-10-22T09:15:03.000Z";
const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

const cellText = (lang: string, label: string | null, code: string): string => `\`\`\`{${lang}}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;
const outputText = async (label: string, engine: string, code: string, content: string, status?: "error"): Promise<string> =>
  formatOutput({ cell: label, source: await deriveCodeHash(code + "\n"), engine, ran: RAN, content, ...(status ? { status } : {}) });

interface Fixture { view: EditorView; dispatched: Transaction[] }

function mountBody(body: string, extra: Plugin[] = []): Fixture {
  const dispatched: Transaction[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({ doc: bodyToDoc(body), plugins: [foldPlugin(), ...extra] }),
    nodeViews: { code_cell: createCodeCellView(), output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })) },
    dispatchTransaction(tr) {
      dispatched.push(tr);
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return { view, dispatched };
}

interface Found { node: PmNode; pos: number; index: number }
function blocks(view: EditorView): Found[] {
  const out: Found[] = [];
  view.state.doc.forEach((node, pos, index) => out.push({ node, pos, index }));
  return out;
}

function headingNamed(view: EditorView, text: string): Found {
  const hit = blocks(view).find((b) => b.node.type.name === "heading" && b.node.textContent === text);
  if (!hit) throw new Error(`no heading ${text}`);
  return hit;
}
const paragraphNamed = (view: EditorView, text: string): Found => {
  const hit = blocks(view).find((b) => b.node.type.name === "paragraph" && b.node.textContent === text);
  if (!hit) throw new Error(`no paragraph ${text}`);
  return hit;
};
const cells = (view: EditorView): Found[] => blocks(view).filter((b) => b.node.type.name === "code_cell");
const outputOf = (view: EditorView, label: string): Found => {
  const hit = blocks(view).find((b) => b.node.type.name === "output" && b.node.attrs.cell === label);
  if (!hit) throw new Error(`no output ${label}`);
  return hit;
};
const dom = (view: EditorView, found: Found): HTMLElement => view.nodeDOM(found.pos) as HTMLElement;
const state = (view: EditorView) => foldStateOf(view.state);
const body = (view: EditorView): string => docToBody(view.state.doc);
const summaryOf = (view: EditorView, found: Found): HTMLElement | null => dom(view, found).querySelector<HTMLElement>(".qmd-cell-summary");
const hiddenBy = (view: EditorView, found: Found): boolean => dom(view, found).classList.contains("qmd-in-collapsed-section");

async function notebookBody(): Promise<string> {
  return [
    cellText("python", "a", "x = 1"), await outputText("a", "python-3.12", "x = 1", "one\n"),
    cellText("python", "b", "y = x + 1"), await outputText("b", "python-3.12", "y = x + 1", "Traceback: boom\n", "error"),
    cellText("python", null, "z = 3"),
  ].join("\n");
}

const SECTIONS = [
  "# Top\n", "Top text\n",
  "## Alpha\n", "Alpha one\n", cellText("python", "ac", "a = 1"), "### Alpha child\n", "Child text\n",
  "## Beta\n", "Beta one\n",
  "# Next\n", "Next text\n",
].join("\n");

describe("foldPlugin state", () => {
  it("3.1a starts with nothing folded and reading off", async () => {
    const { view } = mountBody(await notebookBody());
    expect([...state(view).cells]).toEqual([]);
    expect([...state(view).sections]).toEqual([]);
    expect(state(view).reading).toBe(false);
  });

  it("3.1a keeps a cell by its label and an unlabelled cell by cell-<n>", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    setFold(view, { cell: ["cell-3", true] });
    expect([...state(view).cells].sort()).toEqual(["a", "cell-3"]);
  });

  it("3.1b keeps a section by sectionKey(level, text, occurrence)", () => {
    const { view } = mountBody(SECTIONS);
    setFold(view, { section: [sectionKey(2, "Alpha", 0), true] });
    expect([...state(view).sections]).toEqual(["2:Alpha:0"]);
  });

  it("3.1a removes a key when it is set to false", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    setFold(view, { cell: ["a", false] });
    expect(state(view).cells.has("a")).toBe(false);
  });
});

describe("collapsed cell", () => {
  it("3.1a shows 'Python · text · ran …' on a collapsed python cell with a text output", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    const summary = summaryOf(view, cells(view)[0]!);
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain("Python · text · ran ");
  });

  it("3.1a marks the collapsed cell with qmd-collapsed and its output with qmd-collapsed-output", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    expect(dom(view, cells(view)[0]!).classList.contains("qmd-collapsed")).toBe(true);
    expect(dom(view, outputOf(view, "a")).classList.contains("qmd-collapsed-output")).toBe(true);
  });

  it("3.1a leaves other cells and their outputs expanded", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    expect(dom(view, cells(view)[1]!).classList.contains("qmd-collapsed")).toBe(false);
    expect(dom(view, outputOf(view, "b")).classList.contains("qmd-collapsed-output")).toBe(false);
  });

  it("3.1a contains 'error' in the summary of a collapsed cell whose output is an error", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["b", true] });
    expect(summaryOf(view, cells(view)[1]!)!.textContent).toContain("error");
  });

  it("3.1a says 'no output' and 'not run' on a collapsed cell without output, found by cell-<n>", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["cell-3", true] });
    const text = summaryOf(view, cells(view)[2]!)!.textContent ?? "";
    expect(text).toContain("no output");
    expect(text).toContain("not run");
  });

  it("3.1a drops the collapsed classes when the cell is expanded again", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    setFold(view, { cell: ["a", false] });
    expect(dom(view, cells(view)[0]!).classList.contains("qmd-collapsed")).toBe(false);
    expect(dom(view, outputOf(view, "a")).classList.contains("qmd-collapsed-output")).toBe(false);
  });

  it("3.1a expands the cell when its summary line is clicked", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    summaryOf(view, cells(view)[0]!)!.click();
    expect(state(view).cells.has("a")).toBe(false);
    expect(dom(view, cells(view)[0]!).classList.contains("qmd-collapsed")).toBe(false);
  });

  it("A6 shows an out-of-date summary on a collapsed cell whose code was edited after it ran", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    const { pos, node } = cells(view)[0]!;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, code: "x = 100\n" }));
    await until(() => /out of date/i.test(summaryOf(view, cells(view)[0]!)?.textContent ?? ""));
    expect(summaryOf(view, cells(view)[0]!)!.textContent).toMatch(/out of date/i);
  });

  it("A6 shows 'may be out of date' on a collapsed later cell after a cell above was edited", async () => {
    const body2 = [
      cellText("python", "a", "x = 1"), await outputText("a", "python-3.12", "x = 1", "one\n"),
      cellText("python", "b", "y = x + 1"), await outputText("b", "python-3.12", "y = x + 1", "two\n"),
    ].join("\n");
    const { view } = mountBody(body2, [cascadeStalePlugin({}) as unknown as Plugin]);
    await settle();
    setFold(view, { cell: ["b", true] });
    const first = cells(view)[0]!;
    view.dispatch(view.state.tr.setNodeMarkup(first.pos, undefined, { ...first.node.attrs, code: "x = 10\n" }));
    await until(() => /out of date/i.test(summaryOf(view, cells(view)[1]!)?.textContent ?? ""));
    expect(summaryOf(view, cells(view)[1]!)!.textContent).toMatch(/out of date/i);
  });
});

describe("collapsed section", () => {
  const collapse = (view: EditorView, level: number, text: string) => setFold(view, { section: [sectionKey(level, text, 0), true] });

  it("3.1b marks the collapsed heading with qmd-section-collapsed and leaves it visible", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    const el = dom(view, headingNamed(view, "Alpha"));
    expect(el.classList.contains("qmd-section-collapsed")).toBe(true);
    expect(el.classList.contains("qmd-in-collapsed-section")).toBe(false);
  });

  it("3.1b hides the blocks of a level-2 section up to the next level-2 heading", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    expect(hiddenBy(view, paragraphNamed(view, "Alpha one"))).toBe(true);
    expect(hiddenBy(view, cells(view)[0]!)).toBe(true);
    expect(hiddenBy(view, paragraphNamed(view, "Child text"))).toBe(true);
  });

  it("3.1b hides a level-3 heading inside the collapsed level-2 section", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    expect(hiddenBy(view, headingNamed(view, "Alpha child"))).toBe(true);
  });

  it("3.1b does not hide the next level-2 heading or its blocks", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    expect(hiddenBy(view, headingNamed(view, "Beta"))).toBe(false);
    expect(hiddenBy(view, paragraphNamed(view, "Beta one"))).toBe(false);
  });

  it("3.1b stops a level-2 section at the next level-1 heading, not past it", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Beta");
    expect(hiddenBy(view, paragraphNamed(view, "Beta one"))).toBe(true);
    expect(hiddenBy(view, headingNamed(view, "Next"))).toBe(false);
    expect(hiddenBy(view, paragraphNamed(view, "Next text"))).toBe(false);
  });

  it("3.1b does not hide anything before the collapsed heading", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    expect(hiddenBy(view, headingNamed(view, "Top"))).toBe(false);
    expect(hiddenBy(view, paragraphNamed(view, "Top text"))).toBe(false);
  });

  it("3.1b hides a whole level-1 section through every heading below it, up to the next level-1 heading", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 1, "Top");
    for (const text of ["Alpha", "Alpha child", "Beta"]) expect(hiddenBy(view, headingNamed(view, text))).toBe(true);
    expect(hiddenBy(view, headingNamed(view, "Next"))).toBe(false);
  });

  it("3.1b shows '(N blocks)' on the collapsed heading", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    const el = dom(view, headingNamed(view, "Alpha"));
    const seen = [el.textContent ?? "", ...Array.from(el.querySelectorAll("*")).flatMap((n) => Array.from(n.attributes).map((a) => a.value)), ...Array.from(el.attributes).map((a) => a.value)];
    expect(seen.some((value) => value.includes("(4 blocks)"))).toBe(true);
  });

  it("3.1b shows the blocks again when the section is expanded", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    setFold(view, { section: [sectionKey(2, "Alpha", 0), false] });
    expect(hiddenBy(view, paragraphNamed(view, "Alpha one"))).toBe(false);
    expect(dom(view, headingNamed(view, "Alpha")).classList.contains("qmd-section-collapsed")).toBe(false);
  });

  it("3.1b expands the section when the caret enters one of its hidden blocks", () => {
    const { view } = mountBody(SECTIONS);
    collapse(view, 2, "Alpha");
    const inside = paragraphNamed(view, "Alpha one");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside.pos + 1)));
    expect(state(view).sections.has("2:Alpha:0")).toBe(false);
    expect(hiddenBy(view, paragraphNamed(view, "Alpha one"))).toBe(false);
  });
});

describe("fold changes leave the document alone", () => {
  it("3.1c gives the same body after collapsing and expanding cells", async () => {
    const { view } = mountBody(await notebookBody());
    const before = body(view);
    setFold(view, { cell: ["a", true] });
    setFold(view, { cell: ["b", true] });
    expect(body(view)).toBe(before);
    setFold(view, { cell: ["a", false] });
    expect(body(view)).toBe(before);
  });

  it("3.1c gives the same body after collapsing and expanding sections", () => {
    const { view } = mountBody(SECTIONS);
    const before = body(view);
    setFold(view, { section: [sectionKey(2, "Alpha", 0), true] });
    setFold(view, { section: [sectionKey(1, "Top", 0), true] });
    expect(body(view)).toBe(before);
    setFold(view, { section: [sectionKey(1, "Top", 0), false] });
    expect(body(view)).toBe(before);
  });

  it("3.1c gives the same body after reading mode and fold all", async () => {
    const { view } = mountBody(await notebookBody());
    const before = body(view);
    setFold(view, { reading: true });
    expect(body(view)).toBe(before);
    setFold(view, { all: true });
    expect(body(view)).toBe(before);
    setFold(view, { all: false, reading: false });
    expect(body(view)).toBe(before);
  });

  it("3.1c gives the same body after a click on a summary line expanded the cell", async () => {
    const { view } = mountBody(await notebookBody());
    const before = body(view);
    setFold(view, { cell: ["a", true] });
    summaryOf(view, cells(view)[0]!)!.click();
    expect(body(view)).toBe(before);
  });

  it("3.1c keeps the document node itself when folding", () => {
    const { view } = mountBody(SECTIONS);
    const before = view.state.doc;
    setFold(view, { section: [sectionKey(2, "Alpha", 0), true] });
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it("3.1c sends every fold transaction with addToHistory false and no document change", async () => {
    const { view, dispatched } = mountBody(await notebookBody());
    dispatched.length = 0;
    setFold(view, { cell: ["a", true] });
    setFold(view, { cell: ["a", false] });
    setFold(view, { reading: true });
    expect(dispatched.length).toBeGreaterThanOrEqual(3);
    for (const tr of dispatched) {
      expect(tr.docChanged).toBe(false);
      expect(tr.getMeta("addToHistory")).toBe(false);
    }
  });

  it("3.1c puts no inline style on the editor root", async () => {
    const { view } = mountBody(await notebookBody());
    setFold(view, { cell: ["a", true] });
    expect(view.dom.getAttribute("style") ?? "").toBe("");
  });

  it("A6 collapses a cell and a section in one note and leaves the file text unchanged", async () => {
    const full = `${SECTIONS}\n${await notebookBody()}`;
    const { view } = mountBody(full);
    const before = body(view);
    setFold(view, { section: [sectionKey(2, "Alpha", 0), true] });
    setFold(view, { cell: ["b", true] });
    expect(dom(view, cells(view).find((c) => c.node.attrs.options === "#| label: b\n")!).classList.contains("qmd-collapsed")).toBe(true);
    expect(dom(view, headingNamed(view, "Alpha")).classList.contains("qmd-section-collapsed")).toBe(true);
    expect(body(view)).toBe(before);
  });
});
