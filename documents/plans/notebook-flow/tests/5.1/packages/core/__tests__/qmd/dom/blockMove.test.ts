/** @jest-environment jsdom */
/**
 * Tests moving a cell or a section (spec 5.1, plan D12) through moveBlock, the Alt-ArrowUp / Alt-ArrowDown bindings of qmdKeymap and of a cell's code editor, and the Move up / Move down
 * entries of the ⋯ cell menu: a cell moves with its outputs over the neighbouring paragraph, heading or cell group; a section (the caret in its heading) moves over the neighbouring
 * section of the same level; at the edge nothing happens; one undo step restores the body byte for byte.
 *
 * The view is built here as cellMenu.test.ts does (node views, foldPlugin, history). Written as if the file sat at packages/core/__tests__/qmd/dom/blockMove.test.ts.
 */
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { EditorView, type NodeViewConstructor } from "prosemirror-view";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { foldPlugin } from "../../../src/qmd/dom/foldPlugin";
import { cellMenuEntries } from "../../../src/qmd/dom/cellMenu";
import { moveBlock } from "../../../src/qmd/dom/blockMove";
import { qmdKeymap } from "../../../src/qmd/dom/qmdCommands";
import { mountNoteBar, type NoteActions } from "../../../src/qmd/dom/noteBar";
import { closeMenu, type MenuEntry, type MenuItem } from "../../../src/ui/dom/widgets/menu";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
// Side effect: the TextEncoder shim the code hash needs in jsdom.
import "../../support/nodeViewHarness";

const cellViewWith = createCodeCellView as unknown as (onRun?: unknown, onRestart?: unknown, loadPlotly?: unknown, noteActions?: NoteActions) => NodeViewConstructor;

// jsdom has no layout; CodeMirror measures text ranges, and scrolling a selection into view needs these.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
window.HTMLElement.prototype.scrollIntoView = () => undefined;

// Every test starts by calling a seam, so a missing implementation fails each of them at once.
beforeEach(() => { moveBlock(1); });

const RAN = "2026-10-22T09:15:03.000Z";
const views: EditorView[] = [];
let mountedEditors: QmdEditorHandle[] = [];
afterEach(() => {
  closeMenu();
  while (views.length > 0) views.pop()!.destroy();
  for (const handle of mountedEditors) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mountedEditors = [];
  document.body.innerHTML = "";
});

const cellText = (lang: string, label: string | null, code: string): string => `\`\`\`{${lang}}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;
const outputText = async (label: string, code: string, content: string): Promise<string> =>
  formatOutput({ cell: label, source: await deriveCodeHash(code + "\n"), engine: "python-3.12", ran: RAN, content });

/** first (with two outputs), a paragraph, an unlabelled cell without output, a paragraph. */
async function noteBody(): Promise<string> {
  return [
    cellText("python", "first", "x = 1"), await outputText("first", "x = 1", "one\n"), await outputText("first", "x = 1", "again\n"),
    "between\n",
    cellText("python", null, "y = 2"),
    "tail\n",
  ].join("\n");
}

/** Two cells in a row, the second with an output, then a paragraph. */
async function twoCellsBody(): Promise<string> {
  return [cellText("python", "a", "a = 1"), cellText("python", "b", "b = 2"), await outputText("b", "b = 2", "bee\n"), "after\n"].join("\n");
}

/** A paragraph, a heading, and a cell with an output that ends the note. */
async function cellLastBody(): Promise<string> {
  return ["intro\n", "## Mid\n", cellText("python", "z", "z = 0"), await outputText("z", "z = 0", "zed\n")].join("\n");
}

const SECTIONS = [
  "## Alpha\n", "alpha text\n", cellText("python", "ac", "x = 1"),
  "## Beta\n", "beta text\n", "### Beta sub\n", "sub text\n",
  "## Gamma\n", "gamma text\n",
].join("\n");

const NESTED = ["## Parent\n", "### One\n", "one text\n", "### Two\n", "two text\n", "## Next\n", "next text\n"].join("\n");

/** The actions a host passes: the note bar's own. The bar has no editors, so a scope runs no cell. */
function barActions(): NoteActions {
  const bar = mountNoteBar(document.body.appendChild(document.createElement("div")), { editors: () => [], flush: () => undefined, restart: async () => undefined, canRun: () => true });
  return bar.actionsFor("n");
}

interface Fixture { view: EditorView; dispatched: Transaction[]; actions: NoteActions }

function mountBody(body: string): Fixture {
  const dispatched: Transaction[] = [];
  const actions = barActions();
  const host = document.createElement("div");
  document.body.append(host);
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({ doc: bodyToDoc(body), plugins: [foldPlugin(), history()] }),
    nodeViews: {
      code_cell: cellViewWith(undefined, undefined, undefined, actions),
      output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })),
    },
    dispatchTransaction(tr) {
      dispatched.push(tr);
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return { view, dispatched, actions };
}

interface Found { node: PmNode; pos: number }
function blocks(view: EditorView): Found[] {
  const out: Found[] = [];
  view.state.doc.forEach((node, pos) => out.push({ node, pos }));
  return out;
}
const cellsOf = (view: EditorView): Found[] => blocks(view).filter((b) => b.node.type.name === "code_cell");
const headingOf = (view: EditorView, text: string): Found => {
  const hit = blocks(view).find((b) => b.node.type.name === "heading" && b.node.textContent === text);
  if (!hit) throw new Error(`no heading ${text}`);
  return hit;
};
const typesOf = (view: EditorView): string[] => blocks(view).map((b) => b.node.type.name);
const body = (view: EditorView): string => docToBody(view.state.doc);

/** A signature of one block that tells the blocks of these fixtures apart without depending on their blank-line bookkeeping. */
function sig(node: PmNode): string {
  const own = (node.attrs.raw ?? node.attrs.code ?? node.textContent) as string;
  return `${node.type.name}${node.type.name === "heading" ? String(node.attrs.level) : ""}:${own}`;
}
const sigs = (view: EditorView): string[] => blocks(view).map((b) => sig(b.node));
const reorder = (list: string[], order: number[]): string[] => order.map((index) => list[index]!);

const selectNode = (view: EditorView, pos: number): void => { view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); };
const caretIn = (view: EditorView, found: Found): void => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found.pos + 1))); };
const run = (view: EditorView, dir: -1 | 1): boolean => moveBlock(dir)(view.state, view.dispatch.bind(view), view);
const undoOnce = (view: EditorView): boolean => undo(view.state, view.dispatch.bind(view));
const selectedSig = (view: EditorView): string | null => (view.state.selection instanceof NodeSelection ? sig(view.state.selection.node) : null);

const entry = (entries: MenuEntry[], label: string): MenuItem => {
  const hit = entries.find((candidate): candidate is MenuItem => candidate !== "separator" && candidate.label === label);
  if (!hit) throw new Error(`no entry ${label}`);
  return hit;
};
const entryLabels = (entries: MenuEntry[]): string[] => entries.map((e) => (e === "separator" ? "---" : e.label));

describe("moveBlock on a cell", () => {
  it("5.1a Alt-ArrowDown moves a selected cell with its two outputs below the next paragraph", async () => {
    const { view } = mountBody(await noteBody());
    const before = sigs(view);
    selectNode(view, cellsOf(view)[0]!.pos);
    expect(run(view, 1)).toBe(true);
    expect(typesOf(view)).toEqual(["paragraph", "code_cell", "output", "output", "code_cell", "paragraph"]);
    expect(sigs(view)).toEqual(reorder(before, [3, 0, 1, 2, 4, 5]));
  });

  it("5.1a one undo restores the body byte for byte after moving a cell down", async () => {
    const { view } = mountBody(await noteBody());
    const original = body(view);
    selectNode(view, cellsOf(view)[0]!.pos);
    run(view, 1);
    expect(body(view)).not.toBe(original);
    expect(undoOnce(view)).toBe(true);
    expect(body(view)).toBe(original);
  });

  it("5.1a the moved cell stays selected as a node selection", async () => {
    const { view } = mountBody(await noteBody());
    const first = sigs(view)[0]!;
    selectNode(view, cellsOf(view)[0]!.pos);
    run(view, 1);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(selectedSig(view)).toBe(first);
    expect(view.state.selection.from).toBe(blocks(view)[1]!.pos);
  });

  it("5.1a Alt-ArrowUp moves a cell without outputs above the paragraph before it", async () => {
    const { view } = mountBody(await noteBody());
    const before = sigs(view);
    selectNode(view, cellsOf(view)[1]!.pos);
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [0, 1, 2, 4, 3, 5]));
    expect(selectedSig(view)).toBe(before[4]);
  });

  it("5.1a moves a cell down over the whole next cell group, outputs included", async () => {
    const { view } = mountBody(await twoCellsBody());
    const before = sigs(view);
    selectNode(view, cellsOf(view)[0]!.pos);
    expect(run(view, 1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [1, 2, 0, 3]));
  });

  it("5.1a moves a cell up over the whole previous cell group, taking its own outputs along", async () => {
    const { view } = mountBody(await twoCellsBody());
    const before = sigs(view);
    selectNode(view, cellsOf(view)[1]!.pos);
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [1, 2, 0, 3]));
  });

  it("5.1a with one of the cell's outputs selected the whole cell group moves", async () => {
    const { view } = mountBody(await twoCellsBody());
    const before = sigs(view);
    const output = blocks(view).find((b) => b.node.type.name === "output")!;
    selectNode(view, output.pos);
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [1, 2, 0, 3]));
  });

  it("5.1a moves a cell over a heading as one unit of its own", async () => {
    const { view } = mountBody(await cellLastBody());
    const before = sigs(view);
    selectNode(view, cellsOf(view)[0]!.pos);
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [0, 2, 3, 1]));
  });

  it("5.1a one undo restores the body byte for byte after moving a cell group up", async () => {
    const { view } = mountBody(await twoCellsBody());
    const original = body(view);
    selectNode(view, cellsOf(view)[1]!.pos);
    run(view, -1);
    expect(undoOnce(view)).toBe(true);
    expect(body(view)).toBe(original);
  });

  it("5.1a one move is one transaction that changes the document", async () => {
    const { view, dispatched } = mountBody(await noteBody());
    selectNode(view, cellsOf(view)[0]!.pos);
    const count = dispatched.length;
    run(view, 1);
    expect(dispatched.slice(count).filter((tr) => tr.docChanged)).toHaveLength(1);
  });
});

describe("moveBlock at the edge and on other blocks", () => {
  it("5.1a does nothing for a cell that is the first block when moving up", async () => {
    const { view, dispatched } = mountBody(await noteBody());
    selectNode(view, cellsOf(view)[0]!.pos);
    const before = body(view);
    const count = dispatched.length;
    expect(run(view, -1)).toBe(false);
    expect(body(view)).toBe(before);
    expect(dispatched.length).toBe(count);
  });

  it("5.1a does nothing for a cell group that ends the note when moving down", async () => {
    const { view, dispatched } = mountBody(await cellLastBody());
    selectNode(view, cellsOf(view)[0]!.pos);
    const before = body(view);
    const count = dispatched.length;
    expect(run(view, 1)).toBe(false);
    expect(body(view)).toBe(before);
    expect(dispatched.length).toBe(count);
  });

  it("5.1a does nothing for an output of the last cell group when moving down", async () => {
    const { view } = mountBody(await cellLastBody());
    const before = body(view);
    selectNode(view, blocks(view).find((b) => b.node.type.name === "output")!.pos);
    expect(run(view, 1)).toBe(false);
    expect(body(view)).toBe(before);
  });

  it("5.1a returns false and changes nothing with the caret in a paragraph", async () => {
    const { view } = mountBody(await noteBody());
    const paragraph = blocks(view).find((b) => b.node.type.name === "paragraph")!;
    caretIn(view, paragraph);
    const before = body(view);
    expect(run(view, 1)).toBe(false);
    expect(run(view, -1)).toBe(false);
    expect(body(view)).toBe(before);
  });
});

describe("moveBlock on a section", () => {
  it("5.1b Alt-ArrowUp with the caret in a level-2 heading swaps its section with the previous level-2 section", () => {
    const { view } = mountBody(SECTIONS);
    const before = sigs(view);
    expect(typesOf(view)).toEqual(["heading", "paragraph", "code_cell", "heading", "paragraph", "heading", "paragraph", "heading", "paragraph"]);
    caretIn(view, headingOf(view, "Beta"));
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [3, 4, 5, 6, 0, 1, 2, 7, 8]));
  });

  it("5.1b the section of a level-2 heading includes its level-3 subsections, up to the next level-2 heading", () => {
    const { view } = mountBody(SECTIONS);
    const before = sigs(view);
    caretIn(view, headingOf(view, "Alpha"));
    expect(run(view, 1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [3, 4, 5, 6, 0, 1, 2, 7, 8]));
  });

  it("5.1b moves the last section up over the one before it, leaving the first untouched", () => {
    const { view } = mountBody(SECTIONS);
    const before = sigs(view);
    caretIn(view, headingOf(view, "Gamma"));
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [0, 1, 2, 7, 8, 3, 4, 5, 6]));
  });

  it("5.1b moves a middle section down over the next one", () => {
    const { view } = mountBody(SECTIONS);
    const before = sigs(view);
    caretIn(view, headingOf(view, "Beta"));
    expect(run(view, 1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [0, 1, 2, 7, 8, 3, 4, 5, 6]));
  });

  it("5.1b swaps two level-3 sections inside the same parent, a section ending at the next higher heading", () => {
    const { view } = mountBody(NESTED);
    const before = sigs(view);
    caretIn(view, headingOf(view, "Two"));
    expect(run(view, -1)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [0, 3, 4, 1, 2, 5, 6]));
  });

  it("5.1b keeps the moved heading selected", () => {
    const { view } = mountBody(SECTIONS);
    caretIn(view, headingOf(view, "Beta"));
    run(view, -1);
    const { $from } = view.state.selection;
    expect($from.parent.type.name).toBe("heading");
    expect($from.parent.textContent).toBe("Beta");
    expect($from.before()).toBe(0);
  });

  it("5.1b one undo restores the body byte for byte after moving a section", () => {
    const { view } = mountBody(SECTIONS);
    const original = body(view);
    caretIn(view, headingOf(view, "Beta"));
    run(view, -1);
    expect(body(view)).not.toBe(original);
    expect(undoOnce(view)).toBe(true);
    expect(body(view)).toBe(original);
  });

  it("5.1b does nothing for the first section when moving up", () => {
    const { view, dispatched } = mountBody(SECTIONS);
    caretIn(view, headingOf(view, "Alpha"));
    const before = body(view);
    const count = dispatched.length;
    expect(run(view, -1)).toBe(false);
    expect(body(view)).toBe(before);
    expect(dispatched.length).toBe(count);
  });

  it("5.1b does nothing for the last section when moving down", () => {
    const { view } = mountBody(SECTIONS);
    caretIn(view, headingOf(view, "Gamma"));
    const before = body(view);
    expect(run(view, 1)).toBe(false);
    expect(body(view)).toBe(before);
  });
});

describe("the key bindings", () => {
  it("5.1a qmdKeymap binds Alt-ArrowDown to moving the selected cell down", async () => {
    const { view } = mountBody(await noteBody());
    const before = sigs(view);
    const command = qmdKeymap()["Alt-ArrowDown"];
    expect(typeof command).toBe("function");
    selectNode(view, cellsOf(view)[0]!.pos);
    expect(command!(view.state, view.dispatch.bind(view), view)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [3, 0, 1, 2, 4, 5]));
  });

  it("5.1b qmdKeymap binds Alt-ArrowUp to moving the section of the heading under the caret up", () => {
    const { view } = mountBody(SECTIONS);
    const before = sigs(view);
    const command = qmdKeymap()["Alt-ArrowUp"];
    expect(typeof command).toBe("function");
    caretIn(view, headingOf(view, "Beta"));
    expect(command!(view.state, view.dispatch.bind(view), view)).toBe(true);
    expect(sigs(view)).toEqual(reorder(before, [3, 4, 5, 6, 0, 1, 2, 7, 8]));
  });

  it("5.1a the Alt-ArrowDown binding returns false at the edge", async () => {
    const { view } = mountBody(await cellLastBody());
    selectNode(view, cellsOf(view)[0]!.pos);
    expect(qmdKeymap()["Alt-ArrowDown"]!(view.state, view.dispatch.bind(view), view)).toBe(false);
  });

  it("5.1a Alt-ArrowDown inside a cell's code editor moves the cell below the next paragraph", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountedEditors.push(mountQmdEditor(root, { body: cellText("python", "only", "x = 1") + "\nafter\n", onChange: () => undefined }));
    const order = (): string[] => [...root.querySelector(".ProseMirror")!.children].map((child) => (child.matches(".qmd-cell") ? "cell" : child.tagName.toLowerCase()));
    expect(order().indexOf("cell")).toBeLessThan(order().indexOf("p"));
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, altKey: true, bubbles: true, cancelable: true });
    root.querySelector(".qmd-cell .cm-content")!.dispatchEvent(event);
    expect(order().indexOf("p")).toBeLessThan(order().indexOf("cell"));
  });

  it("5.1a Alt-ArrowUp inside a cell's code editor moves the cell above the paragraph before it", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountedEditors.push(mountQmdEditor(root, { body: "before\n\n" + cellText("python", "only", "x = 1"), onChange: () => undefined }));
    const order = (): string[] => [...root.querySelector(".ProseMirror")!.children].map((child) => (child.matches(".qmd-cell") ? "cell" : child.tagName.toLowerCase()));
    expect(order().indexOf("p")).toBeLessThan(order().indexOf("cell"));
    const event = new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", keyCode: 38, altKey: true, bubbles: true, cancelable: true });
    root.querySelector(".qmd-cell .cm-content")!.dispatchEvent(event);
    expect(order().indexOf("cell")).toBeLessThan(order().indexOf("p"));
  });
});

describe("the cell menu Move up and Move down", () => {
  it("5.1a lists Move up and Move down after Change language and before Delete", async () => {
    const { view, actions } = mountBody(await noteBody());
    const labels = entryLabels(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions));
    expect(labels).toEqual(expect.arrayContaining(["Change language", "Move up", "Move down", "Delete"]));
    expect(labels.indexOf("Move up")).toBeGreaterThan(labels.indexOf("Change language"));
    expect(labels.indexOf("Move down")).toBeGreaterThan(labels.indexOf("Move up"));
    expect(labels.indexOf("Delete")).toBeGreaterThan(labels.indexOf("Move down"));
  });

  it("5.1a Move down moves the cell with its outputs below the next paragraph", async () => {
    const { view, actions } = mountBody(await noteBody());
    const before = sigs(view);
    entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions), "Move down").onSelect();
    expect(sigs(view)).toEqual(reorder(before, [3, 0, 1, 2, 4, 5]));
    expect(selectedSig(view)).toBe(before[0]);
  });

  it("5.1a Move up moves the cell above the paragraph before it", async () => {
    const { view, actions } = mountBody(await noteBody());
    const before = sigs(view);
    entry(cellMenuEntries(view, () => cellsOf(view)[1]!.pos, actions), "Move up").onSelect();
    expect(sigs(view)).toEqual(reorder(before, [0, 1, 2, 4, 3, 5]));
  });

  it("5.1a a move from the menu is undone in one step", async () => {
    const { view, actions } = mountBody(await noteBody());
    const original = body(view);
    entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions), "Move down").onSelect();
    expect(undoOnce(view)).toBe(true);
    expect(body(view)).toBe(original);
  });

  it("5.1a disables Move up for the first block and leaves Move down enabled", async () => {
    const { view, actions } = mountBody(await noteBody());
    const entries = cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions);
    expect(entry(entries, "Move up").disabled).toBe(true);
    expect(entry(entries, "Move down").disabled).toBeFalsy();
  });

  it("5.1a disables Move down for the cell group that ends the note and leaves Move up enabled", async () => {
    const { view, actions } = mountBody(await cellLastBody());
    const entries = cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions);
    expect(entry(entries, "Move down").disabled).toBe(true);
    expect(entry(entries, "Move up").disabled).toBeFalsy();
  });

  it("5.1a a disabled Move up leaves the body as it is", async () => {
    const { view, actions } = mountBody(await noteBody());
    const before = body(view);
    const item = entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, actions), "Move up");
    expect(item.disabled).toBe(true);
    expect(body(view)).toBe(before);
  });

  it("5.1a the opened menu shows Move up disabled on the first cell and enabled on the second", async () => {
    const { view } = mountBody(await noteBody());
    const open = (index: number): void => (view.nodeDOM(cellsOf(view)[index]!.pos) as HTMLElement).querySelector<HTMLButtonElement>("button.qmd-cell-menu")!.click();
    const item = (label: string): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((candidate) => candidate.querySelector(".ls-menu-label")!.textContent === label)!;
    open(0);
    expect(item("Move up").disabled).toBe(true);
    closeMenu();
    open(1);
    expect(item("Move up").disabled).toBe(false);
  });
});

describe("A9 move cell or section in one undo", () => {
  it("A9 a cell with its outputs and a section each move and come back with a single undo", async () => {
    const cellFixture = mountBody(await noteBody());
    const cellOriginal = body(cellFixture.view);
    selectNode(cellFixture.view, cellsOf(cellFixture.view)[0]!.pos);
    expect(run(cellFixture.view, 1)).toBe(true);
    expect(undoOnce(cellFixture.view)).toBe(true);
    expect(body(cellFixture.view)).toBe(cellOriginal);

    const sectionFixture = mountBody(SECTIONS);
    const sectionOriginal = body(sectionFixture.view);
    caretIn(sectionFixture.view, headingOf(sectionFixture.view, "Beta"));
    expect(run(sectionFixture.view, -1)).toBe(true);
    expect(undoOnce(sectionFixture.view)).toBe(true);
    expect(body(sectionFixture.view)).toBe(sectionOriginal);
  });
});
