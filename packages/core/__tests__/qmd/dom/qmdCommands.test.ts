/** @jest-environment jsdom */
/**
 * Tests the writing behaviour of the rich note editor: Markdown input rules while typing, Python fence shortcuts,
 * Backspace on a heading, opening a new node's source editor, and moving the caret through cells, outputs and equations.
 */
import { EditorState, NodeSelection, TextSelection, type Plugin } from "prosemirror-state";
import { history } from "prosemirror-history";
import { EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { codeFenceEnter, qmdInputRules } from "../../../src/qmd/dom/qmdInputRules";
import { editRequestPlugin, headingToParagraph, qmdKeymap, QMD_ACTIONS } from "../../../src/qmd/dom/qmdCommands";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createMathView } from "../../../src/qmd/dom/mathView";
import { blockDragPlugin, blockNavigationPlugin } from "../../../src/qmd/dom/qmdBlocks";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { foldPlugin, setAdvanced } from "../../../src/qmd/dom/foldPlugin";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import type { NoteActions } from "../../../src/qmd/dom/noteBar";
import { para, text } from "../../support/nodeViewHarness";

const views: EditorView[] = [];
let mounted: QmdEditorHandle[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

const nodeViews = { code_cell: createCodeCellView(() => undefined), math_inline: createMathView(false, async () => ({ renderMathSvg: () => "<svg></svg>" })), math_display: createMathView(true, async () => ({ renderMathSvg: () => "<svg></svg>" })) };

function mountDoc(doc: PmNode, plugins: Plugin[] = [qmdInputRules(), editRequestPlugin()], cursor?: number): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const state = EditorState.create({ doc, plugins });
  // jsdom has no layout, so scrolling the selection into view is skipped as the editor does.
  const view = new EditorView(host, { state: cursor === undefined ? state : state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor))), nodeViews, handleScrollToSelection: () => true });
  views.push(view);
  return view;
}

/** Types `typed` one character at a time at the cursor, through the input rules as the browser's text input would. */
function type(view: EditorView, typed: string): void {
  for (const char of typed) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, char, () => view.state.tr));
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const emptyDoc = () => s.node("doc", null, [para()]);

describe("Markdown input rules", () => {
  it.each([
    ["**bold** ", "strong", "bold", "**bold** \n"],
    ["__bold__ ", "strong", "bold", "__bold__ \n"],
    ["*it* ", "em", "it", "*it* \n"],
    ["_it_ ", "em", "it", "_it_ \n"],
    ["`x = 1` ", "code", "x = 1", "`x = 1` \n"],
  ])("turns %j into a %s mark with the same written delimiter", (typed, mark, inner, body) => {
    const view = mountDoc(emptyDoc());
    type(view, typed);
    const marked = view.state.doc.firstChild!.firstChild!;
    expect(marked.text).toBe(inner);
    expect(marked.marks.map((m) => m.type.name)).toEqual([mark]);
    expect(view.state.doc.firstChild!.lastChild!.marks).toEqual([]);
    expect(docToBody(view.state.doc)).toBe(body);
  });

  it("leaves underscores inside words alone", () => {
    const view = mountDoc(emptyDoc());
    type(view, "snake_case_name ");
    expect(view.state.doc.firstChild!.firstChild!.marks).toEqual([]);
    expect(view.state.doc.textContent).toBe("snake_case_name ");
  });

  it.each(["``` ", "```python ", "```{python} ", "```py "])("turns %j into a Python cell and puts the caret in its code", async (typed) => {
    const view = mountDoc(emptyDoc());
    type(view, typed);
    const cell = view.state.doc.firstChild!;
    expect(cell.type.name).toBe("code_cell");
    expect(cell.attrs.lang).toBe("python");
    await tick();
    expect(document.activeElement?.closest(".qmd-cell-code")).not.toBeNull();
  });

  it("turns ``` followed by Enter into a Python cell", () => {
    const view = mountDoc(emptyDoc());
    type(view, "```");
    expect(codeFenceEnter(view.state, view.dispatch, view)).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe("code_cell");
    expect(docToBody(view.state.doc)).toMatch(/^```\{python\}\n```\n/);
  });

  it("opens the LaTeX field of display math made with $$", async () => {
    const view = mountDoc(emptyDoc());
    type(view, "$$");
    expect(view.state.doc.firstChild!.type.name).toBe("math_display");
    await tick();
    expect(document.activeElement).toBe(view.dom.querySelector('textarea[aria-label="TeX source"]'));
  });

  it("opens \\begin{align} on an empty line as display math holding aligned, the caret on its empty line", async () => {
    const view = mountDoc(emptyDoc());
    type(view, "\\begin{align}");
    expect(view.state.doc.firstChild!.type.name).toBe("math_display");
    expect(view.state.doc.firstChild!.attrs.tex).toBe("\\begin{aligned}\n\n\\end{aligned}");
    await tick();
    const input = view.dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="TeX source"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe("\\begin{aligned}\n".length);
  });

  it("opens an empty display equation for \\[ on an empty line, as $$ does", async () => {
    const view = mountDoc(emptyDoc());
    type(view, "\\[");
    expect(view.state.doc.firstChild!.type.name).toBe("math_display");
    await tick();
    expect(document.activeElement).toBe(view.dom.querySelector('textarea[aria-label="TeX source"]'));
  });
});

describe("LaTeX delimiters typed in text", () => {
  /** The block types of the document, with the caret's block and offset. */
  const shape = (view: EditorView) => view.state.doc.content.content.map((node) => node.type.name);
  const caret = (view: EditorView) => ({ block: view.state.selection.$from.index(0), offset: view.state.selection.$from.parentOffset });

  it("turns \\(tex\\) into inline math stored with dollars, keeping the caret after it", () => {
    const view = mountDoc(emptyDoc());
    type(view, "Area \\(\\pi r^2\\) here");
    const inline = view.state.doc.firstChild!.child(1);
    expect(inline.type.name).toBe("math_inline");
    expect(inline.attrs.tex).toBe("\\pi r^2");
    expect(docToBody(view.state.doc)).toBe("Area $\\pi r^2$ here\n");
  });

  it.each([["$$", "$"], ["\\[", "\\"]])("turns a paragraph holding only %sx^2%s and its closing character into display math and continues below it", (open, close) => {
    // Typing the opener on an empty line already opens an empty equation, so the line holds the rest before its last character.
    const written = `${open}x^2${close}`;
    const view = mountDoc(s.node("doc", null, [para(text(written))]), undefined, written.length + 1);
    type(view, open === "$$" ? "$" : "]");
    expect(shape(view)).toEqual(["math_display", "paragraph"]);
    expect(view.state.doc.firstChild!.attrs.tex).toBe("x^2");
    expect(caret(view)).toEqual({ block: 1, offset: 0 });
    type(view, "Next");
    expect(docToBody(view.state.doc)).toBe("$$x^2$$\n\nNext\n");
  });

  it.each([["$$", "$$"], ["\\[", "\\]"]])("splits the paragraph around %sE = mc^2%s typed mid-text", (open, close) => {
    const view = mountDoc(s.node("doc", null, [para(text("Before  after"))]), undefined, 8);
    type(view, `${open}E = mc^2${close}`);
    expect(shape(view)).toEqual(["paragraph", "math_display", "paragraph"]);
    expect(view.state.doc.child(1).attrs.tex).toBe("E = mc^2");
    expect(caret(view)).toEqual({ block: 2, offset: 0 });
    expect(docToBody(view.state.doc)).toBe("Before \n\n$$E = mc^2$$\n\n after\n");
  });

  it("leaves a lone $ and inline $x$ as they were", () => {
    const view = mountDoc(emptyDoc());
    type(view, "Costs $5 and $x$ ");
    expect(view.state.doc.firstChild!.child(1).type.name).toBe("math_inline");
    expect(docToBody(view.state.doc)).toBe("Costs $5 and $x$ \n");
  });
});

describe("editing commands", () => {
  it("Backspace at the start of a heading makes it a paragraph", () => {
    const view = mountDoc(s.node("doc", null, [s.node("heading", { level: 2 }, [text("Title")])]), [], 1);
    expect(headingToParagraph(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(view.state.doc.textContent).toBe("Title");
  });

  it("Backspace inside a heading is left to the default handling", () => {
    const view = mountDoc(s.node("doc", null, [s.node("heading", { level: 2 }, [text("Title")])]), [], 3);
    expect(headingToParagraph(view.state, view.dispatch)).toBe(false);
  });

  it("an inline equation made from an empty selection opens its LaTeX field", async () => {
    const view = mountDoc(s.node("doc", null, [para(text("see "))]), [editRequestPlugin()], 5);
    QMD_ACTIONS.inlineMath.command(view.state, view.dispatch, view);
    await tick();
    expect(document.activeElement).toBe(view.dom.querySelector('input[aria-label="TeX source"]'));
  });

  it("an inserted code cell takes the caret", async () => {
    const view = mountDoc(emptyDoc(), [editRequestPlugin()], 1);
    QMD_ACTIONS.codeCell.command(view.state, view.dispatch, view);
    await tick();
    expect(document.activeElement?.closest(".qmd-cell-code")).not.toBeNull();
  });
});

describe("moving through blocks", () => {
  const output = () => s.node("output", { cell: "c", source: "s", engine: "python", ran: "2026-10-30", raw: formatOutput({ cell: "c", source: "s", engine: "python", ran: "2026-10-30", content: "42\n" }) });
  const cellWithOutput = () => s.node("doc", null, [s.node("code_cell", { lang: "python", options: "#| label: c\n", code: "print(42)\n", info: "{python}" }), output()]);
  const keyDown = (view: EditorView, key: string) => view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key }))) ?? false;
  const selectOutput = (view: EditorView) => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize)));

  it("typing on a selected output writes a new paragraph after it and keeps the output", () => {
    const view = mountDoc(cellWithOutput(), [blockNavigationPlugin()]);
    selectOutput(view);
    type(view, "Hi");
    expect(view.state.doc.childCount).toBe(3);
    expect(view.state.doc.child(1).type.name).toBe("output");
    expect(view.state.doc.lastChild!.textContent).toBe("Hi");
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
  });

  it.each(["ArrowDown", "Enter"])("%s on a selected output at the end of the note opens a paragraph after it", (key) => {
    const view = mountDoc(cellWithOutput(), [blockNavigationPlugin()]);
    selectOutput(view);
    expect(keyDown(view, key)).toBe(true);
    expect(view.state.doc.lastChild!.type.name).toBe("paragraph");
    expect(view.state.selection).toBeInstanceOf(TextSelection);
    expect(view.state.selection.$from.parent).toBe(view.state.doc.lastChild);
  });

  it("ArrowUp on a selected output opens its cell's code at the end while the code shows (Advanced on)", async () => {
    const view = mountDoc(cellWithOutput(), [blockNavigationPlugin(), foldPlugin()]);
    setAdvanced(view, true);
    selectOutput(view);
    expect(keyDown(view, "ArrowUp")).toBe(true);
    expect(document.activeElement?.closest(".qmd-cell-code")).not.toBeNull();
  });

  it("ArrowRight beside an inline equation opens its LaTeX field at the start, and ArrowLeft there returns before it", async () => {
    const view = mountDoc(s.node("doc", null, [para(text("see "), s.node("math_inline", { tex: "x^2" }), text(" here"))]), [blockNavigationPlugin()], 5);
    expect(keyDown(view, "ArrowRight")).toBe(true);
    await tick();
    const input = view.dom.querySelector<HTMLInputElement>('input[aria-label="TeX source"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(view.dom.querySelector(".qmd-math-edit")).toBeNull();
    expect(view.state.selection.from).toBe(5);
  });
});

describe("dragging a cell with its outputs", () => {
  const output = (cell: string) => s.node("output", { cell, source: "s", engine: "python", ran: "2026-10-30", raw: formatOutput({ cell, source: "s", engine: "python", ran: "2026-10-30", content: `${cell}\n` }) });
  const cell = (label: string) => s.node("code_cell", { lang: "python", options: `#| label: ${label}\n`, code: `print("${label}")\n`, info: "{python}" });
  const names = (view: EditorView) => { const out: string[] = []; view.state.doc.forEach((node) => out.push(node.type.name === "paragraph" ? `p:${node.textContent}` : `${node.type.name}:${node.attrs.cell || node.attrs.options.trim()}`)); return out; };

  function dragTo(view: EditorView, from: Element, drop: number): void {
    const transfer = { data: {} as Record<string, string>, clearData() { this.data = {}; }, setData(type: string, value: string) { this.data[type] = value; }, effectAllowed: "" };
    const started = view.someProp("handleDOMEvents", (handlers) => handlers.dragstart?.(view, { target: from, dataTransfer: transfer } as unknown as DragEvent));
    expect(started).toBe(true);
    expect(transfer.data["text/plain"]).toContain("```{python}");
    view.posAtCoords = () => ({ pos: drop, inside: -1 });
    expect(view.someProp("handleDrop", (handle) => handle(view, { clientX: 0, clientY: 0 } as DragEvent, view.dragging!.slice, true))).toBe(true);
  }

  it("dragging an output moves its cell along with it", () => {
    const doc = s.node("doc", null, [cell("a"), output("a"), para(text("text")), cell("b")]);
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({ doc, plugins: [blockDragPlugin()] }), nodeViews: { ...nodeViews, output: createOutputView() }, handleScrollToSelection: () => true });
    views.push(view);
    dragTo(view, view.dom.querySelector(".qmd-output")!, view.state.doc.content.size);
    expect(names(view)).toEqual(["p:text", "code_cell:#| label: b", "code_cell:#| label: a", "output:a"]);
  });

  it("a drop just before another cell's output lands after that output", () => {
    const doc = s.node("doc", null, [cell("a"), output("a"), cell("b"), output("b")]);
    const view = mountDoc(doc, [blockDragPlugin()]);
    const beforeOutputB = doc.child(0).nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize;
    dragTo(view, view.dom.querySelector(".qmd-cell-actions")!, beforeOutputB);
    expect(names(view)).toEqual(["code_cell:#| label: b", "output:b", "code_cell:#| label: a", "output:a"]);
  });
});

// --- F8 / Shift-F8 and revealProblem (spec 5.1, plan D12): a note with error outputs, as problemNav.test.ts builds it
// jsdom has no layout; scrolling a selection into view needs these.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
window.HTMLElement.prototype.scrollIntoView = () => undefined;
const RAN = "2026-10-22T09:15:03.000Z";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(60);
const cellText = (lang: string, label: string | null, code: string): string => `\`\`\`{${lang}}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;
const outputText = async (label: string, code: string, content: string, status?: "error"): Promise<string> =>
  formatOutput({ cell: label, source: await deriveCodeHash(code + "\n"), engine: "python-3.12", ran: RAN, content, ...(status ? { status } : {}) });
/**
 * Blocks: 0 intro, 1 cell a, 2 ok output, 3 middle, 4 cell b, 5 error "Traceback one", 6 later, 7 cell c, 8 error "Traceback two", 9 end.
 * The outputs have the hash of their cell's code, so only the error outputs are problems.
 */
async function navBody(): Promise<string> {
  return [
    "intro\n",
    cellText("python", "a", "a = 1"), await outputText("a", "a = 1", "fine\n"),
    "middle\n",
    cellText("python", "b", "b = 2"), await outputText("b", "b = 2", "Traceback one\n", "error"),
    "later\n",
    cellText("python", "c", "c = 3"), await outputText("c", "c = 3", "Traceback two\n", "error"),
    "end\n",
  ].join("\n");
}
async function quietBody(): Promise<string> {
  return ["intro\n", cellText("python", "a", "a = 1"), await outputText("a", "a = 1", "fine\n"), "end\n"].join("\n");
}
async function oneErrorBody(): Promise<string> {
  return ["head\n", cellText("python", "e", "e = 5"), await outputText("e", "e = 5", "Traceback only\n", "error"), "foot\n"].join("\n");
}
interface Found { node: PmNode; pos: number }
function blocks(view: EditorView): Found[] {
  const out: Found[] = [];
  view.state.doc.forEach((node, pos) => out.push({ node, pos }));
  return out;
}
const outputsOf = (view: EditorView): Found[] => blocks(view).filter((b) => b.node.type.name === "output");
function mountPlain(body: string): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ doc: bodyToDoc(body), plugins: [foldPlugin(), history()] }) });
  views.push(view);
  return view;
}
const caretAt = (view: EditorView, pos: number): void => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))); };
const press = (view: EditorView, key: "F8" | "Shift-F8"): boolean => qmdKeymap()[key]!(view.state, view.dispatch.bind(view), view);
const selectedOutput = (view: EditorView): number | null => {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "output") return null;
  return outputsOf(view).findIndex((found) => found.pos === selection.from);
};

describe("F8 and Shift-F8 in qmdKeymap", () => {
  it("5.1c binds F8 and Shift-F8", () => {
    expect(typeof qmdKeymap()["F8"]).toBe("function");
    expect(typeof qmdKeymap()["Shift-F8"]).toBe("function");
  });

  it("5.1c F8 selects the next error output after the caret, skipping an ok output", async () => {
    const view = mountPlain(await navBody());
    caretAt(view, 1);
    expect(press(view, "F8")).toBe(true);
    expect(selectedOutput(view)).toBe(1);
  });

  it("5.1c F8 again selects the following error output", async () => {
    const view = mountPlain(await navBody());
    caretAt(view, 1);
    press(view, "F8");
    press(view, "F8");
    expect(selectedOutput(view)).toBe(2);
  });

  it("5.1c Shift-F8 selects the previous error output before the selection", async () => {
    const view = mountPlain(await navBody());
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, outputsOf(view)[2]!.pos)));
    expect(press(view, "Shift-F8")).toBe(true);
    expect(selectedOutput(view)).toBe(1);
  });

  it("5.1c F8 after the last error output wraps to the first within the item", async () => {
    const view = mountPlain(await navBody());
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, outputsOf(view)[2]!.pos)));
    press(view, "F8");
    expect(selectedOutput(view)).toBe(1);
  });

  it("5.1c Shift-F8 before the first error output wraps to the last within the item", async () => {
    const view = mountPlain(await navBody());
    caretAt(view, 1);
    press(view, "Shift-F8");
    expect(selectedOutput(view)).toBe(2);
  });

  it("5.1c F8 reaches an output marked is-out-of-date as a problem", async () => {
    const view = mountPlain(await navBody());
    (view.nodeDOM(outputsOf(view)[0]!.pos) as HTMLElement).classList.add("is-out-of-date");
    caretAt(view, 1);
    press(view, "F8");
    expect(selectedOutput(view)).toBe(0);
  });

  it("5.1c F8 and Shift-F8 leave the selection alone when the note has no problem", async () => {
    const view = mountPlain(await quietBody());
    caretAt(view, 2);
    const before = view.state.selection;
    press(view, "F8");
    expect(view.state.selection.eq(before)).toBe(true);
    press(view, "Shift-F8");
    expect(view.state.selection.eq(before)).toBe(true);
  });

  it("5.1c F8 with a single error output keeps selecting it", async () => {
    const view = mountPlain(await oneErrorBody());
    caretAt(view, 1);
    press(view, "F8");
    expect(selectedOutput(view)).toBe(0);
    press(view, "F8");
    expect(selectedOutput(view)).toBe(0);
  });
});

interface EditorFixture { root: HTMLElement; handle: QmdEditorHandle }
function mountEditor(body: string, extra: Partial<Parameters<typeof mountQmdEditor>[1]> & { noteActions?: NoteActions } = {}): EditorFixture {
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mountQmdEditor(root, { body, onChange: () => undefined, ...extra });
  mounted.push(handle);
  return { root, handle };
}
const outputDoms = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".ProseMirror > .qmd-output")];
/** The index among the output blocks of the selected one, or null. */
const selectedIndex = (root: HTMLElement): number | null => {
  const index = outputDoms(root).findIndex((dom) => dom.classList.contains("ProseMirror-selectednode"));
  return index === -1 ? null : index;
};

describe("revealProblem on the handle", () => {
  it("5.1c from the edge going forward selects the first error output, focuses the editor and returns true", async () => {
    const { root, handle } = mountEditor(await navBody());
    await settle();
    expect(handle.revealProblem(1, "edge")).toBe(true);
    expect(selectedIndex(root)).toBe(1);
    expect(root.querySelector(".ProseMirror")!.contains(document.activeElement)).toBe(true);
  });

  it("5.1c from the edge going backward selects the last error output", async () => {
    const { root, handle } = mountEditor(await navBody());
    await settle();
    expect(handle.revealProblem(-1, "edge")).toBe(true);
    expect(selectedIndex(root)).toBe(2);
  });

  it("5.1c from the caret going forward continues after the selected output and stops at the last", async () => {
    const { root, handle } = mountEditor(await navBody());
    await settle();
    expect(handle.revealProblem(1, "edge")).toBe(true);
    expect(handle.revealProblem(1, "caret")).toBe(true);
    expect(selectedIndex(root)).toBe(2);
    expect(handle.revealProblem(1, "caret")).toBe(false);
    expect(selectedIndex(root)).toBe(2);
  });

  it("5.1c from the caret going backward continues before the selected output and stops at the first", async () => {
    const { root, handle } = mountEditor(await navBody());
    await settle();
    expect(handle.revealProblem(-1, "edge")).toBe(true);
    expect(handle.revealProblem(-1, "caret")).toBe(true);
    expect(selectedIndex(root)).toBe(1);
    expect(handle.revealProblem(-1, "caret")).toBe(false);
    expect(selectedIndex(root)).toBe(1);
  });

  it("5.1c from the caret at the start of the note going forward finds the first error output", async () => {
    const { root, handle } = mountEditor(await navBody());
    await settle();
    expect(handle.revealProblem(1, "caret")).toBe(true);
    expect(selectedIndex(root)).toBe(1);
  });

  it("5.1c returns false and selects nothing when the note has no problem", async () => {
    const { root, handle } = mountEditor(await quietBody());
    await settle();
    expect(handle.revealProblem(1, "edge")).toBe(false);
    expect(handle.revealProblem(-1, "edge")).toBe(false);
    expect(handle.revealProblem(1, "caret")).toBe(false);
    expect(selectedIndex(root)).toBeNull();
  });

  it("5.1c a miss changes neither the fold state nor the selection", async () => {
    const { root, handle } = mountEditor(await quietBody());
    await settle();
    handle.collapseAll();
    const before = [...handle.foldState().cells].sort();
    expect(before).toEqual(["a"]);
    expect(handle.revealProblem(1, "edge")).toBe(false);
    expect([...handle.foldState().cells].sort()).toEqual(before);
    expect(selectedIndex(root)).toBeNull();
  });

  it("5.1c expands the collapsed cell holding the output and leaves other cells collapsed", async () => {
    const { root, handle } = mountEditor(await navBody());
    await settle();
    handle.collapseAll();
    expect([...handle.foldState().cells].sort()).toEqual(["a", "b", "c"]);
    expect(handle.revealProblem(1, "edge")).toBe(true);
    expect([...handle.foldState().cells].sort()).toEqual(["a", "c"]);
    expect(selectedIndex(root)).toBe(1);
  });

  it("5.1c expands the collapsed section hiding the output", async () => {
    const body = ["intro\n", "## Deep\n", cellText("python", "d", "d = 4"), await outputText("d", "d = 4", "Traceback deep\n", "error")].join("\n");
    const { root, handle } = mountEditor(body);
    await settle();
    handle.collapseAll();
    expect([...handle.foldState().sections]).toEqual(["2:Deep:0"]);
    expect(handle.revealProblem(1, "edge")).toBe(true);
    expect([...handle.foldState().sections]).toEqual([]);
    expect(selectedIndex(root)).toBe(0);
  });
});

