/** @jest-environment jsdom */
/**
 * Tests the drawing node view and the Insert drawing action (plan drawings, D5, D6, D11): the stored SVG shown through the
 * sanitizer, the redraw from the model, the "TikZ edited by hand" state, opening the editor through a stub loader on click or
 * Enter, and the commit as one transaction. Loaders and the drawing editor are stubs; the canvas is a recording stub.
 */
import { createHash } from "node:crypto";
import { history, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, NodeSelection, TextSelection, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Command } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { docToBody } from "../../../src/qmd/editor/qmdDoc";
import { createDrawingView, type DrawingEditorLoader } from "../../../src/qmd/dom/drawingView";
import { editRequestPlugin, qmdKeymap, QMD_ACTIONS } from "../../../src/qmd/dom/qmdCommands";
import { showToast } from "../../../src/ui/dom/widgets/toast";
import { until, settle, para, text } from "../../support/nodeViewHarness";

jest.mock("../../../src/ui/dom/widgets/toast", () => ({ showToast: jest.fn(() => () => undefined) }));

type MathModule = { renderMathSvg(tex: string, display: boolean): string };
type Model = Record<string, unknown>;
type Done = (model: Model | null) => void;

const TIKZ = [
  "\\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]",
  "\\coordinate (pp1) at (0,0);",
  "\\coordinate (pp2) at (6,0);",
  "\\draw[->] (pp1) -- (pp2);",
  "\\end{tikzpicture}",
].join("\n");
const MODEL: Model = {
  v: 1,
  points: [{ id: "p1", x: 0, y: 0, dot: true, label: "A" }, { id: "p2", x: 6, y: 0, dot: true }],
  items: [{ k: "seg", a: "p1", b: "p2", arrow: "end" }],
};
const BIGGER: Model = {
  v: 1,
  points: [{ id: "p1", x: 0, y: 0, dot: true }, { id: "p2", x: 6, y: 0, dot: true }, { id: "p3", x: 6, y: 4, dot: true }],
  items: [{ k: "seg", a: "p1", b: "p2", arrow: "end" }, { k: "seg", a: "p2", b: "p3", arrow: "none" }],
};
const EMPTY: Model = { v: 1, points: [], items: [] };
const GOOD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><line x1="0" y1="0" x2="13" y2="5" stroke="currentColor"/></svg>';
const HOSTILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10" onload="window.HOSTILE=1"><script>window.HOSTILE=2</script><line x1="0" y1="0" x2="13" y2="5" stroke="currentColor"/></svg>';
const LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M0 0L8 8"/></svg>';
const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";

const hashOf = (tikz: string): string => createHash("sha256").update(tikz, "utf8").digest("hex").slice(0, 12);

function block(options: { svg?: string; tikz?: string; source?: string; model?: Model; eol?: string } = {}): string {
  const { svg = GOOD_SVG, tikz = TIKZ, source = hashOf(tikz), model = MODEL, eol = "\n" } = options;
  const parts = [
    `\`\`\`{=latex}\n\\makeatletter\\@ifundefined{tikzpicture}{\\iftrue}{${tikz}\\iffalse}\\makeatother\n\`\`\``,
    `![](data:image/png;base64,${PNG}){fig-alt="Drawing"}`,
    "```{=latex}\n\\fi\n```",
    `\`\`\`{=labshelf-svg}\n${svg}\n\`\`\``,
    `\`\`\`{=labshelf-drawing}\n${JSON.stringify(model)}\n\`\`\``,
  ];
  return `::: {.labshelf-drawing source=${source}}\n${parts.join("\n\n")}\n:::\n`.replace(/\n/g, eol);
}

/** The model JSON stored in a block's labshelf-drawing fence. */
function storedModel(raw: string): Model {
  const match = /```\{=labshelf-drawing\}\r?\n([^\r\n]*)\r?\n```/.exec(raw);
  if (!match) throw new Error(`no model fence in: ${raw.slice(0, 80)}`);
  return JSON.parse(match[1]!) as Model;
}

// jsdom has no canvas: the painter gets a recording stub that returns a fixed PNG data URL.
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToDataURL = HTMLCanvasElement.prototype.toDataURL;
const globals = globalThis as unknown as { Path2D?: unknown };
const realPath2D = globals.Path2D;
beforeAll(() => {
  const context = new Proxy({}, { get: (_target, name) => (name === "canvas" ? undefined : () => undefined), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
  globals.Path2D = class { constructor() { return new Proxy(this, { get: (target, name) => (name in target ? (target as never)[name] : () => undefined) }); } };
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  HTMLCanvasElement.prototype.toDataURL = realToDataURL;
  globals.Path2D = realPath2D;
});

interface Session {
  view: EditorView;
  loadEditor: jest.Mock;
  loadMath: jest.Mock;
  renderMathSvg: jest.Mock;
  openDrawingEditor: jest.Mock;
  destroy: jest.Mock;
  /** The `done` callback of the latest open editor, or undefined while none is open. */
  done(): Done;
  opened(): number;
  transactions: Transaction[];
}

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

function open(doc: PmNode, extra: Plugin[] = []): Session {
  let latest: Done | undefined;
  const destroy = jest.fn();
  const openDrawingEditor = jest.fn((_host: HTMLElement, _model: unknown, done: Done) => { latest = done; return { destroy }; });
  const loadEditor = jest.fn(async () => ({ openDrawingEditor }));
  const renderMathSvg = jest.fn((_tex: string, _display: boolean) => LABEL_SVG);
  const loadMath = jest.fn(async (): Promise<MathModule> => ({ renderMathSvg }));
  const transactions: Transaction[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [editRequestPlugin(), history(), keymap(qmdKeymap()), ...extra] }),
    nodeViews: { drawing: createDrawingView(loadEditor as unknown as DrawingEditorLoader, loadMath) },
    handleScrollToSelection: () => true,
    dispatchTransaction(tr) {
      if (tr.docChanged) transactions.push(tr);
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return { view, loadEditor, loadMath, renderMathSvg, openDrawingEditor, destroy, done: () => latest!, opened: () => openDrawingEditor.mock.calls.length, transactions };
}

const docWith = (raw: string, eol = "\n"): PmNode =>
  s.node("doc", { eol, trailing: "", unterminated: false }, [para(text("Before")), s.node("drawing", { raw, gap: eol }), para(text("After"))]);

/** Position of the first drawing node. */
function drawingPos(view: EditorView): number {
  let found = -1;
  view.state.doc.forEach((node, offset) => { if (found < 0 && node.type.name === "drawing") found = offset; });
  return found;
}

const drawings = (view: EditorView): PmNode[] => {
  const list: PmNode[] = [];
  view.state.doc.forEach((node) => { if (node.type.name === "drawing") list.push(node); });
  return list;
};

/** Clicks the innermost first element of the drawing's view, so a handler on any ancestor sees it. */
function clickDrawing(view: EditorView): void {
  let target = view.nodeDOM(drawingPos(view)) as HTMLElement;
  while (target.firstElementChild) target = target.firstElementChild as HTMLElement;
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

const dom = (view: EditorView): HTMLElement => view.nodeDOM(drawingPos(view)) as HTMLElement;
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-dialog");
const HAND_EDITED = "This TikZ was edited by hand. Editing the diagram replaces it.";
const handEditedBlock = (): string => block({ tikz: TIKZ.replace("(6,0)", "(7,0)"), source: hashOf(TIKZ) });

describe("drawing view showing the stored drawing", () => {
  it("A7 shows the stored SVG without calling loadEditor or loadMath when it passes the sanitizer", async () => {
    const session = open(docWith(block()));
    await settle(150);
    expect(dom(session.view).querySelector("svg line[x2='13']")).not.toBeNull();
    expect(session.loadEditor).not.toHaveBeenCalled();
    expect(session.loadMath).not.toHaveBeenCalled();
  });

  it("A7 shows no editor and no MathJax for several valid drawings in one note", async () => {
    const doc = s.node("doc", null, [s.node("drawing", { raw: block() }), para(text("Between")), s.node("drawing", { raw: block({ svg: GOOD_SVG.replace("x2=\"13\"", "x2=\"9\"") }) })]);
    const session = open(doc);
    await settle(150);
    expect(session.view.dom.querySelectorAll("svg line").length).toBe(2);
    expect(session.loadEditor).not.toHaveBeenCalled();
    expect(session.loadMath).not.toHaveBeenCalled();
  });

  it("A7 redraws from the model once MathJax loads when the stored SVG fails the sanitizer", async () => {
    const session = open(docWith(block({ svg: HOSTILE_SVG })));
    await until(() => session.loadMath.mock.calls.length > 0 && dom(session.view).querySelector("svg") !== null);
    expect(session.renderMathSvg.mock.calls.some(([tex]) => tex === "A")).toBe(true);
    expect(session.loadEditor).not.toHaveBeenCalled();
  });

  it("A7 never puts a hostile stored SVG's script or handlers in the DOM", async () => {
    const session = open(docWith(block({ svg: HOSTILE_SVG })));
    await until(() => session.loadMath.mock.calls.length > 0 && dom(session.view).querySelector("svg") !== null);
    await settle(50);
    expect(session.view.dom.querySelector("script")).toBeNull();
    expect(session.view.dom.innerHTML).not.toContain("onload");
    expect(session.view.dom.innerHTML).not.toContain("HOSTILE");
    expect((window as unknown as { HOSTILE?: unknown }).HOSTILE).toBeUndefined();
  });

  it("A7 leaves no style attribute in the drawing's DOM, stored or redrawn", async () => {
    const stored = open(docWith(block({ svg: GOOD_SVG.replace("<line", '<line style="stroke:red"') })));
    await until(() => stored.loadMath.mock.calls.length > 0 && dom(stored.view).querySelector("svg") !== null);
    expect(dom(stored.view).innerHTML).not.toMatch(/\sstyle=/);
    const valid = open(docWith(block()));
    expect(dom(valid.view).innerHTML).not.toMatch(/\sstyle=/);
  });

  it("A4 shows 'TikZ edited by hand' when the block's source no longer matches its TikZ", () => {
    const session = open(docWith(handEditedBlock()));
    expect(dom(session.view).textContent).toContain("TikZ edited by hand");
  });

  it("A4 does not show the hand-edited state for an untouched block", () => {
    const session = open(docWith(block()));
    expect(dom(session.view).textContent).not.toContain("edited by hand");
  });

  it("A4 still shows the stored SVG of a hand-edited block", () => {
    const session = open(docWith(handEditedBlock()));
    expect(dom(session.view).querySelector("svg line[x2='13']")).not.toBeNull();
  });
});

describe("drawing view opening the editor", () => {
  it("A5 opens the editor through the loader on click, in place inside the node's view, with the stored model", async () => {
    const session = open(docWith(block()));
    clickDrawing(session.view);
    await until(() => session.opened() > 0);
    expect(session.loadEditor).toHaveBeenCalledTimes(1);
    const [host, model] = session.openDrawingEditor.mock.calls[0] as [HTMLElement, Model];
    expect(dom(session.view).contains(host)).toBe(true);
    expect(model).toEqual(MODEL);
  });

  it("A5 opens the editor on Enter when the drawing is the selected node", async () => {
    const session = open(docWith(block()));
    session.view.dispatch(session.view.state.tr.setSelection(NodeSelection.create(session.view.state.doc, drawingPos(session.view))));
    dom(session.view).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => session.opened() > 0);
    expect(session.loadEditor).toHaveBeenCalled();
  });

  it("A5 does not load the editor of a read-only note on click", async () => {
    const session = open(docWith(block()));
    session.view.setProps({ editable: () => false });
    clickDrawing(session.view);
    await settle(100);
    expect(session.loadEditor).not.toHaveBeenCalled();
  });

  it("A5 shows a dashed placeholder 'Empty drawing' for a drawing with no content", () => {
    const session = open(docWith(""));
    expect(dom(session.view).textContent).toMatch(/Empty drawing/);
    expect(dom(session.view).querySelector(".qmd-drawing-figure svg")).toBeNull();
  });

  it("A5 Insert drawing puts an empty drawing node in place of the empty paragraph and opens the editor at once", async () => {
    const session = open(s.node("doc", null, [para(text("Before")), para()]));
    session.view.dispatch(session.view.state.tr.setSelection(TextSelection.create(session.view.state.doc, session.view.state.doc.content.size - 1)));
    const insert = (QMD_ACTIONS as unknown as Record<string, { label: string; command: Command }>).drawing!;
    expect(insert.label).toBe("Diagram");
    expect(insert.command(session.view.state, session.view.dispatch.bind(session.view), session.view)).toBe(true);
    expect(drawings(session.view)).toHaveLength(1);
    expect(drawings(session.view)[0]!.attrs.raw).toBe("");
    await until(() => session.opened() > 0);
    expect(session.openDrawingEditor.mock.calls[0]![1]).toMatchObject({ v: 1, points: [], items: [] });
  });
});

describe("drawing view asking before overwriting hand-edited TikZ", () => {
  it("A4 asks before loading the editor for a hand-edited block", async () => {
    const session = open(docWith(handEditedBlock()));
    clickDrawing(session.view);
    await until(() => dialog() !== null);
    expect(document.body.textContent).toContain(HAND_EDITED);
    await settle(50);
    expect(session.loadEditor).not.toHaveBeenCalled();
  });

  it("A4 does not open the editor when the question is cancelled", async () => {
    const session = open(docWith(handEditedBlock()));
    clickDrawing(session.view);
    await until(() => dialog() !== null);
    dialog()!.querySelector<HTMLElement>(".ls-btn:not(.ls-btn-primary)")!.click();
    await settle(100);
    expect(session.loadEditor).not.toHaveBeenCalled();
    expect(session.opened()).toBe(0);
    expect(drawings(session.view)[0]!.attrs.raw).toBe(handEditedBlock());
  });

  it("A4 loads and opens the editor once the question is accepted", async () => {
    const session = open(docWith(handEditedBlock()));
    clickDrawing(session.view);
    await until(() => dialog() !== null);
    dialog()!.querySelector<HTMLElement>(".ls-btn-primary")!.click();
    await until(() => session.opened() > 0);
    expect(session.loadEditor).toHaveBeenCalledTimes(1);
  });

  it("A4 opens an untouched block without asking", async () => {
    const session = open(docWith(block()));
    clickDrawing(session.view);
    await until(() => session.opened() > 0);
    expect(dialog()).toBeNull();
  });
});

describe("drawing view committing", () => {
  async function opened(raw: string, eol = "\n"): Promise<Session> {
    const session = open(docWith(raw, eol), []);
    clickDrawing(session.view);
    await until(() => session.opened() > 0);
    return session;
  }

  it("A5 commits a model as one doc-changing transaction of one step that replaces the drawing's raw", async () => {
    const original = block();
    const session = await opened(original);
    session.done()(BIGGER);
    await until(() => session.transactions.length > 0);
    await settle(100);
    expect(session.transactions).toHaveLength(1);
    expect(session.transactions[0]!.steps).toHaveLength(1);
    expect(drawings(session.view)).toHaveLength(1);
    const raw = drawings(session.view)[0]!.attrs.raw as string;
    expect(raw).not.toBe(original);
    expect(storedModel(raw)).toEqual(BIGGER);
  });

  it("A5 writes the committed block as the whole stored form, with the PNG painted and the source hash of its TikZ", async () => {
    const session = await opened(block());
    session.done()(BIGGER);
    await until(() => session.transactions.length > 0);
    const raw = drawings(session.view)[0]!.attrs.raw as string;
    expect(raw).toMatch(/^::: \{\.labshelf-drawing source=[0-9a-f]{12}\}\n/);
    expect(raw).toContain("```{=labshelf-svg}");
    expect(raw).toContain("\\begin{tikzpicture}");
    expect(raw).toContain("![](data:image/png;base64,");
    const tikz = /(\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\})/.exec(raw)![1]!;
    expect(raw).toContain(`source=${hashOf(tikz)}`);
    expect(raw.endsWith(":::\n")).toBe(true);
  });

  it("A5 writes the committed block with the file's line ending", async () => {
    const session = await opened(block({ eol: "\r\n" }), "\r\n");
    session.done()(BIGGER);
    await until(() => session.transactions.length > 0);
    const raw = drawings(session.view)[0]!.attrs.raw as string;
    expect(raw).toContain("\r\n");
    expect(raw.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("A5 leaves the neighbouring blocks and the node's position as they were", async () => {
    const session = await opened(block());
    const pos = drawingPos(session.view);
    session.done()(BIGGER);
    await until(() => session.transactions.length > 0);
    expect(drawingPos(session.view)).toBe(pos);
    expect(session.view.state.doc.childCount).toBe(3);
    expect(session.view.state.doc.child(0).textContent).toBe("Before");
    expect(session.view.state.doc.child(2).textContent).toBe("After");
  });

  it("A5 undoes the whole editing session with one note undo", async () => {
    const original = block();
    const session = await opened(original);
    const before = docToBody(session.view.state.doc);
    session.done()(BIGGER);
    await until(() => session.transactions.length > 0);
    await settle(50);
    expect(docToBody(session.view.state.doc)).not.toBe(before);
    expect(undoDepth(session.view.state)).toBe(1);
    expect(undo(session.view.state, session.view.dispatch.bind(session.view))).toBe(true);
    expect(docToBody(session.view.state.doc)).toBe(before);
    expect(drawings(session.view)[0]!.attrs.raw).toBe(original);
  });

  it("A5 shows the committed drawing's SVG in the view afterwards", async () => {
    const session = await opened(block());
    session.done()(BIGGER);
    await until(() => session.transactions.length > 0);
    await until(() => dom(session.view).querySelectorAll("svg line, svg path").length > 0);
    expect(dom(session.view).textContent).not.toContain("edited by hand");
  });

  it("A5 changes nothing when the editor reports no model", async () => {
    const original = block();
    const session = await opened(original);
    session.done()(null);
    await settle(150);
    expect(session.transactions).toHaveLength(0);
    expect(drawings(session.view)[0]!.attrs.raw).toBe(original);
  });

  it("A5 removes the node when Done comes with an empty model", async () => {
    const session = open(docWith(""));
    clickDrawing(session.view);
    await until(() => session.opened() > 0);
    session.done()(EMPTY);
    await until(() => drawings(session.view).length === 0);
    expect(() => session.view.state.doc.check()).not.toThrow();
    expect(session.view.state.doc.childCount).toBeGreaterThanOrEqual(2);
    expect(session.view.state.doc.textContent).toContain("Before");
    expect(session.view.state.doc.textContent).toContain("After");
  });

  it("A5 keeps the editor open and the note unchanged, with a toast, when the block is over the cap", async () => {
    const original = block();
    const session = await opened(original);
    const huge: Model = { ...BIGGER, items: [...(BIGGER.items as unknown[]), { k: "text", x: 1, y: 1, tex: "x".repeat(300_000) }] };
    session.done()(huge);
    await until(() => (showToast as jest.Mock).mock.calls.length > 0);
    await settle(50);
    expect(session.transactions).toHaveLength(0);
    expect(drawings(session.view)[0]!.attrs.raw).toBe(original);
    expect(session.destroy).not.toHaveBeenCalled();
  });
});
