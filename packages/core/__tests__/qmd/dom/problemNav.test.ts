/** @jest-environment jsdom */
/**
 * Tests jumping to the next / previous problem (spec 5.1, plan D12) through findProblem, outputProblem, and the note bar's jumpProblem and Next problem / Previous problem menu entries across editors. A problem is an output: an error result, one that is out of date or one
 * that may be out of date. The F8 / Shift-F8 key in mountQmdEditor is here; its qmdKeymap bindings and the handle's revealProblem are in qmdCommands.test.ts.
 * Setups mirror cellMenu.test.ts (a real EditorView, cellText / outputText with formatOutput status "error"), noteBar.test.ts (a fake editor handle, the menu helpers) and qmdEditor.test.ts
 * (mountQmdEditor). Written as if the file sat at packages/core/__tests__/qmd/dom/problemNav.test.ts.
 */
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { history } from "prosemirror-history";
import { EditorView } from "prosemirror-view";
import { bodyToDoc } from "../../../src/qmd/editor";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { foldPlugin } from "../../../src/qmd/dom/foldPlugin";
import { findProblem, outputProblem } from "../../../src/qmd/dom/problemNav";
import { qmdKeymap, shortcutLabel } from "../../../src/qmd/dom/qmdCommands";
import { mountNoteBar, type NoteActions, type NoteBarEditor } from "../../../src/qmd/dom/noteBar";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
// Side effect: the TextEncoder shim the code hash needs in jsdom.
import "../../support/nodeViewHarness";

// jsdom has no layout; CodeMirror measures text ranges, and scrolling a selection into view needs these.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
window.HTMLElement.prototype.scrollIntoView = () => undefined;

const RAN = "2026-10-22T09:15:03.000Z";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(60);

const views: EditorView[] = [];
let mounted: QmdEditorHandle[] = [];
afterEach(() => {
  closeMenu();
  while (views.length > 0) views.pop()!.destroy();
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

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

beforeEach(() => { findProblem(bodyToDoc("a\n"), 0, 1, () => false); });

describe("findProblem", () => {
  const doc = bodyToDoc("intro\n\nmiddle\n\nlater\n\nend\n");
  const positions: number[] = [];
  doc.forEach((_node, pos) => positions.push(pos));

  it("5.1c finds the first top-level block after from when walking forward", () => {
    const problems = new Set([positions[1]!, positions[3]!]);
    expect(findProblem(doc, positions[0]!, 1, (pos) => problems.has(pos))).toBe(positions[1]);
  });

  it("5.1c skips the block at from itself when walking forward", () => {
    const problems = new Set([positions[1]!, positions[3]!]);
    expect(findProblem(doc, positions[1]!, 1, (pos) => problems.has(pos))).toBe(positions[3]);
  });

  it("5.1c finds the last top-level block before from when walking backward", () => {
    const problems = new Set([positions[0]!, positions[2]!]);
    expect(findProblem(doc, positions[3]!, -1, (pos) => problems.has(pos))).toBe(positions[2]);
  });

  it("5.1c skips the block at from itself when walking backward", () => {
    const problems = new Set([positions[0]!, positions[2]!]);
    expect(findProblem(doc, positions[2]!, -1, (pos) => problems.has(pos))).toBe(positions[0]);
  });

  it("5.1c returns null when no block after from is a problem, without wrapping", () => {
    const problems = new Set([positions[0]!]);
    expect(findProblem(doc, positions[1]!, 1, (pos) => problems.has(pos))).toBeNull();
  });

  it("5.1c returns null when no block before from is a problem, without wrapping", () => {
    const problems = new Set([positions[3]!]);
    expect(findProblem(doc, positions[2]!, -1, (pos) => problems.has(pos))).toBeNull();
  });

  it("5.1c returns null when nothing is a problem", () => {
    expect(findProblem(doc, positions[1]!, 1, () => false)).toBeNull();
    expect(findProblem(doc, positions[1]!, -1, () => false)).toBeNull();
  });

  it("5.1c finds the very first block from before the start", () => {
    expect(findProblem(doc, -1, 1, (pos) => pos === positions[0])).toBe(positions[0]);
  });

  it("5.1c finds the very last block from past the end", () => {
    expect(findProblem(doc, doc.content.size, -1, (pos) => pos === positions[3])).toBe(positions[3]);
  });

  it("5.1c asks isProblem only about positions of top-level blocks", () => {
    const asked: number[] = [];
    findProblem(doc, -1, 1, (pos) => { asked.push(pos); return false; });
    expect(asked.length).toBeGreaterThan(0);
    for (const pos of asked) expect(positions).toContain(pos);
  });

  it("5.1c walks a document with cells and outputs by the position of each top-level block", async () => {
    const view = mountPlain(await navBody());
    const outputs = outputsOf(view);
    const isErrorBlock = (pos: number): boolean => outputs.slice(1).some((found) => found.pos === pos);
    expect(findProblem(view.state.doc, -1, 1, isErrorBlock)).toBe(outputs[1]!.pos);
    expect(findProblem(view.state.doc, outputs[1]!.pos, 1, isErrorBlock)).toBe(outputs[2]!.pos);
    expect(findProblem(view.state.doc, outputs[2]!.pos, -1, isErrorBlock)).toBe(outputs[1]!.pos);
  });
});

describe("outputProblem", () => {
  const classOf = (view: EditorView, pos: number): DOMTokenList => (view.nodeDOM(pos) as HTMLElement).classList;

  it("5.1c answers 'error' for an output whose opener has status=\"error\"", async () => {
    const view = mountPlain(await navBody());
    expect(outputProblem(view, outputsOf(view)[1]!.pos)).toBe("error");
    expect(outputProblem(view, outputsOf(view)[2]!.pos)).toBe("error");
  });

  it("5.1c answers null for an ok output without stale classes", async () => {
    const view = mountPlain(await navBody());
    expect(outputProblem(view, outputsOf(view)[0]!.pos)).toBeNull();
  });

  it("5.1c answers 'out-of-date' for an ok output whose DOM has is-out-of-date", async () => {
    const view = mountPlain(await navBody());
    const { pos } = outputsOf(view)[0]!;
    classOf(view, pos).add("is-out-of-date");
    expect(outputProblem(view, pos)).toBe("out-of-date");
  });

  it("5.1c answers 'maybe-stale' for an ok output whose DOM has is-maybe-stale", async () => {
    const view = mountPlain(await navBody());
    const { pos } = outputsOf(view)[0]!;
    classOf(view, pos).add("is-maybe-stale");
    expect(outputProblem(view, pos)).toBe("maybe-stale");
  });

  it("5.1c answers 'out-of-date' when the DOM has both stale classes", async () => {
    const view = mountPlain(await navBody());
    const { pos } = outputsOf(view)[0]!;
    classOf(view, pos).add("is-maybe-stale", "is-out-of-date");
    expect(outputProblem(view, pos)).toBe("out-of-date");
  });

  it("5.1c answers 'error' before a stale class on the same output", async () => {
    const view = mountPlain(await navBody());
    const { pos } = outputsOf(view)[1]!;
    classOf(view, pos).add("is-out-of-date", "is-maybe-stale");
    expect(outputProblem(view, pos)).toBe("error");
  });

  it("5.1c answers null for a node that is not an output", async () => {
    const view = mountPlain(await navBody());
    for (const found of blocks(view)) if (found.node.type.name !== "output") expect(outputProblem(view, found.pos)).toBeNull();
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
const selectedIndex = (root: HTMLElement): number | null => {
  const index = outputDoms(root).findIndex((dom) => dom.classList.contains("ProseMirror-selectednode"));
  return index === -1 ? null : index;
};


/** Every revealProblem call of the fake editors, in order, as "<item>:<dir>:<from>". */
let calls: string[] = [];
beforeEach(() => { calls = []; });

interface FakeEditor extends NoteBarEditor { reveal: jest.Mock }
function fakeEditor(itemId: string, hit: boolean): FakeEditor {
  const reveal = jest.fn((dir: -1 | 1, from: "caret" | "edge") => { calls.push(`${itemId}:${dir}:${from}`); return hit; });
  const fake = {
    setBody: jest.fn(), flush: jest.fn(), focus: jest.fn(), destroy: jest.fn(),
    sections: jest.fn(() => []), notebook: jest.fn(() => []), markUpstreamChange: jest.fn(),
    collapseAll: jest.fn(), expandAll: jest.fn(), setReading: jest.fn(),
    foldState: jest.fn(() => ({ cells: new Set<string>(), sections: new Set<string>(), reading: false })),
    revealProblem: reveal,
    outline: jest.fn(() => []), reveal: jest.fn(), outlineOpen: jest.fn(() => false), setOutlineOpen: jest.fn(),
  };
  return { itemId, handle: fake as unknown as QmdEditorHandle, reveal };
}

function fakeBar(hits: Record<string, boolean>): { host: HTMLElement; bar: ReturnType<typeof mountNoteBar>; editors: FakeEditor[] } {
  const host = document.createElement("div");
  document.body.append(host);
  const editors = Object.entries(hits).map(([id, hit]) => fakeEditor(id, hit));
  const bar = mountNoteBar(host, { editors: () => editors, flush: () => undefined, restart: async () => undefined, canRun: () => true });
  return { host, bar, editors };
}

const jump = (bar: ReturnType<typeof mountNoteBar>, itemId: string, dir: -1 | 1): void => (bar.actionsFor(itemId) as unknown as { jumpProblem(dir: -1 | 1): void }).jumpProblem(dir);

describe("the note bar jumpProblem", () => {
  it("5.1c searches from the caret of the item itself first and stops at a hit", () => {
    const { bar } = fakeBar({ a: true, b: true });
    jump(bar, "a", 1);
    expect(calls).toEqual(["a:1:caret"]);
  });

  it("5.1c goes on with the edge of the following editor when the item has no problem after the caret", () => {
    const { bar } = fakeBar({ a: false, b: true, c: true });
    jump(bar, "a", 1);
    expect(calls).toEqual(["a:1:caret", "b:1:edge"]);
  });

  it("5.1c wraps round to the start item itself with the edge when no editor has a problem, in editors() order", () => {
    const { bar } = fakeBar({ a: false, b: false, c: false });
    jump(bar, "b", 1);
    expect(calls).toEqual(["b:1:caret", "c:1:edge", "a:1:edge", "b:1:edge"]);
  });

  it("5.1c wraps round to the first editor and stops at its hit", () => {
    const { bar } = fakeBar({ a: true, b: false });
    jump(bar, "b", 1);
    expect(calls).toEqual(["b:1:caret", "a:1:edge"]);
  });

  it("5.1c wraps back to the start item's own earlier problem with the edge", () => {
    const { bar } = fakeBar({ a: false });
    jump(bar, "a", 1);
    expect(calls).toEqual(["a:1:caret", "a:1:edge"]);
  });

  it("5.1c going backward visits the preceding editors from their edge and wraps to the end", () => {
    const { bar } = fakeBar({ a: false, b: false, c: false });
    jump(bar, "b", -1);
    expect(calls).toEqual(["b:-1:caret", "a:-1:edge", "c:-1:edge", "b:-1:edge"]);
  });

  it("5.1c going backward stops at the first hit among the preceding editors", () => {
    const { bar } = fakeBar({ a: true, b: false, c: false });
    jump(bar, "c", -1);
    expect(calls).toEqual(["c:-1:caret", "b:-1:edge", "a:-1:edge"]);
  });

  it("5.1c calls no revealProblem while mounting the bar or taking its actions", () => {
    const { bar, editors } = fakeBar({ a: true, b: true });
    bar.actionsFor("a");
    for (const editor of editors) expect(editor.reveal).not.toHaveBeenCalled();
  });
});

const moreButton = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Note actions"]')!;
const menuOf = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-menu");
const menuLabels = (): string[] =>
  [...menuOf()!.children].map((child) => (child.getAttribute("role") === "separator" ? "---" : child.querySelector(".ls-menu-label")!.textContent!));
const menuItem = (label: string): HTMLButtonElement => {
  const hit = [...menuOf()!.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((item) => item.querySelector(".ls-menu-label")!.textContent === label);
  if (!hit) throw new Error(`no menu item ${label}`);
  return hit;
};

describe("the note menu Next problem and Previous problem", () => {
  it("5.1c lists Next problem and Previous problem after Reading mode", () => {
    const { host } = fakeBar({ a: false, b: false });
    moreButton(host).click();
    const labels = menuLabels();
    expect(labels).toEqual(expect.arrayContaining(["Reading mode", "Next problem", "Previous problem"]));
    expect(labels.indexOf("Next problem")).toBeGreaterThan(labels.indexOf("Reading mode"));
    expect(labels.indexOf("Previous problem")).toBeGreaterThan(labels.indexOf("Reading mode"));
  });

  it("5.1c gives the entries the F8 and Shift-F8 hints", () => {
    const { host } = fakeBar({ a: false, b: false });
    moreButton(host).click();
    expect(menuItem("Next problem").querySelector(".hint")!.textContent).toBe(shortcutLabel("F8"));
    expect(menuItem("Previous problem").querySelector(".hint")!.textContent).toBe(shortcutLabel("Shift-F8"));
  });

  it("5.1c Next problem with no focused editor starts from the first editor with the edge and stops at a hit", () => {
    const { host } = fakeBar({ a: true, b: true });
    moreButton(host).click();
    menuItem("Next problem").click();
    expect(calls).toEqual(["a:1:edge"]);
  });

  it("5.1c Next problem with no focused editor goes on to the following editor when the first has none", () => {
    const { host } = fakeBar({ a: false, b: true });
    moreButton(host).click();
    menuItem("Next problem").click();
    expect(calls.slice(0, 2)).toEqual(["a:1:edge", "b:1:edge"]);
  });

  it("5.1c Previous problem asks one editor for its last problem, from the edge", () => {
    const { host } = fakeBar({ a: true, b: true });
    moreButton(host).click();
    menuItem("Previous problem").click();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^[ab]:-1:edge$/);
  });
});

// --- real editors under a real bar

interface Pair { host: HTMLElement; bar: ReturnType<typeof mountNoteBar>; a: EditorFixture; b: EditorFixture }
async function realPair(aBody: string, bBody: string): Promise<Pair> {
  const a = mountEditor(aBody);
  const b = mountEditor(bBody);
  const host = document.createElement("div");
  document.body.prepend(host);
  const editors: NoteBarEditor[] = [{ itemId: "a", handle: a.handle }, { itemId: "b", handle: b.handle }];
  const bar = mountNoteBar(host, { editors: () => editors, flush: () => undefined, restart: async () => undefined, canRun: () => true });
  await settle();
  return { host, bar, a, b };
}

describe("the note bar over two real editors", () => {
  it("5.1c jumps from an item without a problem to the error output of the next item", async () => {
    const { bar, a, b } = await realPair(await quietBody(), await oneErrorBody());
    jump(bar, "a", 1);
    expect(selectedIndex(a.root)).toBeNull();
    expect(selectedIndex(b.root)).toBe(0);
  });

  it("5.1c wraps from the last item to an error output in the first", async () => {
    const { bar, a, b } = await realPair(await oneErrorBody(), await quietBody());
    jump(bar, "b", 1);
    expect(selectedIndex(a.root)).toBe(0);
    expect(selectedIndex(b.root)).toBeNull();
  });

  it("5.1c jumps backward from the first item's start to the last error output of the second item", async () => {
    const { bar, a, b } = await realPair(await oneErrorBody(), await navBody());
    jump(bar, "a", -1);
    expect(selectedIndex(b.root)).toBe(2);
    expect(selectedIndex(a.root)).toBeNull();
  });

  it("5.1c selects nothing in either item when neither has a problem", async () => {
    const { bar, a, b } = await realPair(await quietBody(), await quietBody());
    jump(bar, "a", 1);
    expect(selectedIndex(a.root)).toBeNull();
    expect(selectedIndex(b.root)).toBeNull();
  });

  it("5.1c Next problem in the note menu starts from the focused editor", async () => {
    const { host, a, b } = await realPair(await oneErrorBody(), await oneErrorBody());
    b.handle.focus();
    moreButton(host).click();
    menuItem("Next problem").click();
    expect(selectedIndex(b.root)).toBe(0);
    expect(selectedIndex(a.root)).toBeNull();
  });
});

describe("A9 next and previous problem", () => {
  it("A9 F8 then Shift-F8 in one item go to the second error output and back to the first", async () => {
    const view = mountPlain(await navBody());
    caretAt(view, 1);
    press(view, "F8");
    press(view, "F8");
    expect(selectedOutput(view)).toBe(2);
    press(view, "Shift-F8");
    expect(selectedOutput(view)).toBe(1);
  });

  it("A9 the note bar jumps across two editors in either direction", async () => {
    const { bar, a, b } = await realPair(await oneErrorBody(), await navBody());
    jump(bar, "a", 1);
    expect(selectedIndex(a.root)).toBe(0);
    jump(bar, "a", 1);
    expect(selectedIndex(b.root)).toBe(1);
    jump(bar, "b", 1);
    expect(selectedIndex(b.root)).toBe(2);
    jump(bar, "b", -1);
    expect(selectedIndex(b.root)).toBe(1);
    jump(bar, "b", -1);
    expect(a.root.querySelector(".ProseMirror")!.contains(document.activeElement)).toBe(true);
  });
});

const f8 = (target: Element, shift = false): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "F8", code: "F8", keyCode: 119, shiftKey: shift });
  target.dispatchEvent(event); return event;
};

describe("F8 and Shift-F8 in the editor", () => {
  const actionsWithJump = (): NoteActions & { jumpProblem: jest.Mock } => ({ runScope: jest.fn(), canRun: () => true, jumpProblem: jest.fn() });

  it("5.1c F8 on the note surface calls noteActions.jumpProblem(1)", async () => {
    const actions = actionsWithJump();
    const { root } = mountEditor(await navBody(), { noteActions: actions });
    f8(root.querySelector(".ProseMirror")!);
    expect(actions.jumpProblem).toHaveBeenCalledWith(1);
  });

  it("5.1c Shift-F8 on the note surface calls noteActions.jumpProblem(-1)", async () => {
    const actions = actionsWithJump();
    const { root } = mountEditor(await navBody(), { noteActions: actions });
    f8(root.querySelector(".ProseMirror")!, true);
    expect(actions.jumpProblem).toHaveBeenCalledWith(-1);
  });

  it("5.1c F8 inside a cell's code editor calls noteActions.jumpProblem(1)", async () => {
    const actions = actionsWithJump();
    const { root } = mountEditor(await navBody(), { noteActions: actions });
    f8(root.querySelector(".qmd-cell .cm-content")!);
    expect(actions.jumpProblem).toHaveBeenCalledWith(1);
  });

  it("5.1c Shift-F8 inside a cell's code editor calls noteActions.jumpProblem(-1)", async () => {
    const actions = actionsWithJump();
    const { root } = mountEditor(await navBody(), { noteActions: actions });
    f8(root.querySelector(".qmd-cell .cm-content")!, true);
    expect(actions.jumpProblem).toHaveBeenCalledWith(-1);
  });

  it("5.1c F8 without noteActions selects the first error output of the item", async () => {
    const { root } = mountEditor(await navBody());
    await settle();
    f8(root.querySelector(".ProseMirror")!);
    expect(selectedIndex(root)).toBe(1);
  });

  it("5.1c F8 without noteActions wraps round within the item", async () => {
    const { root } = mountEditor(await navBody());
    await settle();
    f8(root.querySelector(".ProseMirror")!);
    f8(root.querySelector(".ProseMirror")!);
    expect(selectedIndex(root)).toBe(2);
    f8(root.querySelector(".ProseMirror")!);
    expect(selectedIndex(root)).toBe(1);
  });

  it("5.1c Shift-F8 without noteActions wraps from the start of the item to its last error output", async () => {
    const { root } = mountEditor(await navBody());
    await settle();
    f8(root.querySelector(".ProseMirror")!, true);
    expect(selectedIndex(root)).toBe(2);
  });

  it("5.1c F8 inside a cell's code editor without noteActions selects the first error output", async () => {
    const { root } = mountEditor(await navBody());
    await settle();
    f8(root.querySelector(".qmd-cell .cm-content")!);
    expect(selectedIndex(root)).toBe(1);
  });
});

