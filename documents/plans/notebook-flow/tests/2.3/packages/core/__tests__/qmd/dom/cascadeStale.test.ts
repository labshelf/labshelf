/** @jest-environment jsdom */
/**
 * Tests cascading staleness (D7) through cascadeStalePlugin mounted on a view with code cell and output node views: editing a cell marks the outputs of later cells of the same language
 * "May be out of date: a cell above changed since this ran" with a Run below action; other languages and earlier cells are untouched, a rerun clears the mark, own-code "Out of date" keeps priority,
 * and the plugin never changes the document.
 */
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { cascadeStalePlugin } from "../../../src/qmd/dom/cascadeStale";
import { docToBody } from "../../../src/qmd/editor";
import { until, settle } from "../../support/nodeViewHarness";

const MAYBE = "May be out of date: a cell above changed since this ran";
const RAN_BEFORE = "2026-10-22T09:15:03.000Z";
const CODES = { a: "x = 1\n", b: "y = x + 1\n", c: "Plot[x]\n" } as const;

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

function outputNode(label: string, engine: string, source: string, ran: string, content = `result-${label}\n`): PmNode {
  const raw = formatOutput({ cell: label, source, engine, ran, content });
  return s.node("output", { cell: label, source, engine, ran, raw });
}

function cellNode(label: string, lang: string, code: string): PmNode {
  return s.node("code_cell", { lang, options: `#| label: ${label}\n`, code, info: `{${lang}}` });
}

/** Cell a (python), cell b (python), cell c (mathematica), each followed by an output that ran before any edit made by a test and matches its code. */
async function notebookDoc(): Promise<PmNode> {
  return s.node("doc", null, [
    cellNode("a", "python", CODES.a), outputNode("a", "python-3.12", await deriveCodeHash(CODES.a), RAN_BEFORE),
    cellNode("b", "python", CODES.b), outputNode("b", "python-3.12", await deriveCodeHash(CODES.b), RAN_BEFORE),
    cellNode("c", "mathematica", CODES.c), outputNode("c", "wolframscript", await deriveCodeHash(CODES.c), RAN_BEFORE),
  ]);
}

function mountWith(doc: PmNode, plugins: Plugin[]): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, {
    state: EditorState.create({ doc, plugins }),
    nodeViews: { code_cell: createCodeCellView(), output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })) },
  });
  views.push(view);
  return view;
}

/** A view with the cascade plugin, and a twin without it that receives the same transactions. */
async function mountPair(onRunBelow?: (key: string) => void) {
  const doc = await notebookDoc();
  const view = mountWith(doc, [cascadeStalePlugin(onRunBelow ? { onRunBelow } : {}) as unknown as Plugin]);
  const plain = mountWith(doc, []);
  return { view, plain };
}

function find(view: EditorView, type: string, label: string): { pos: number; node: PmNode } {
  const hits: Array<{ pos: number; node: PmNode }> = [];
  view.state.doc.descendants((node, pos) => {
    const name = node.attrs.cell as string | undefined;
    const options = node.attrs.options as string | undefined;
    if (node.type.name === type && (name === label || options === `#| label: ${label}\n`)) hits.push({ pos, node });
    return false;
  });
  if (hits.length === 0) throw new Error(`no ${type} ${label}`);
  return hits[0]!;
}

/** Applies `change` to the same node in every view, as the inner code editor does when the user edits a cell. */
function setAttrs(views: EditorView[], type: string, label: string, change: Record<string, unknown>): void {
  for (const view of views) {
    const { pos, node } = find(view, type, label);
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...change }));
  }
}

const editCode = (views: EditorView[], label: string, code: string) => setAttrs(views, "code_cell", label, { code });

async function rerun(views: EditorView[], label: string, engine: string, code: string): Promise<void> {
  const ran = new Date(Date.now() + 60_000).toISOString();
  const source = await deriveCodeHash(code);
  const raw = formatOutput({ cell: label, source, engine, ran, content: `again-${label}\n` });
  setAttrs(views, "output", label, { source, ran, raw });
}

function outputEl(view: EditorView, label: string): HTMLElement {
  const { pos } = find(view, "output", label);
  return view.nodeDOM(pos) as HTMLElement;
}

const text = (el: HTMLElement) => el.textContent ?? "";
const marked = (view: EditorView, label: string) => text(outputEl(view, label)).includes(MAYBE);
const runBelowButtons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>("button, [role=button]")).filter((b) => /run below/i.test(b.textContent ?? ""));
const body = (view: EditorView) => docToBody(view.state.doc);

describe("2.3 cascading staleness", () => {
  it("2.3a marks the output of a later python cell after cell 1 is edited", async () => {
    const { view } = await mountPair(jest.fn());
    await settle();
    expect(marked(view, "b")).toBe(false);
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    expect(text(outputEl(view, "b"))).toContain(MAYBE);
  });

  it("2.3a gives the marked output a Run below action", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    expect(runBelowButtons(outputEl(view, "b"))).toHaveLength(1);
  });

  it("2.3a calls onRunBelow with the key of the marked cell when Run below is clicked", async () => {
    const onRunBelow = jest.fn();
    const { view } = await mountPair(onRunBelow);
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    runBelowButtons(outputEl(view, "b"))[0]!.click();
    expect(onRunBelow).toHaveBeenCalledTimes(1);
    expect(onRunBelow).toHaveBeenCalledWith("b");
  });

  it("2.3a does not mark a later mathematica cell", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    await settle();
    expect(marked(view, "c")).toBe(false);
    expect(runBelowButtons(outputEl(view, "c"))).toHaveLength(0);
  });

  it("2.3a does not mark the edited cell itself with the cascade caption", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    expect(marked(view, "a")).toBe(false);
  });

  it("2.3a does not mark a python cell above the edited cell", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "b", "y = 5\n");
    await until(() => text(outputEl(view, "b")).includes("Out of date"));
    await settle();
    expect(marked(view, "a")).toBe(false);
  });

  it("2.3a shows the caption without a Run below action when there is no onRunBelow", async () => {
    const { view } = await mountPair();
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    expect(runBelowButtons(view.dom)).toHaveLength(0);
  });

  it("2.3a keeps own-code Out of date on a cell whose own code also changed, without the cascade caption", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "b", "y = 5\n");
    await until(() => text(outputEl(view, "b")).includes("Out of date"));
    editCode([view], "a", "x = 10\n");
    await settle(150);
    expect(text(outputEl(view, "b"))).toContain("Out of date");
    expect(marked(view, "b")).toBe(false);
  });

  it("2.3a leaves a python output whose own code changed marked Out of date, not May be out of date, while cell 1 is edited first", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    editCode([view], "b", "y = 5\n");
    await until(() => text(outputEl(view, "b")).includes("Out of date"));
    expect(marked(view, "b")).toBe(false);
  });
});

describe("2.3 rerunning and the document", () => {
  it("2.3b clears the mark when the marked cell is rerun", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    await rerun([view], "b", "python-3.12", CODES.b);
    await until(() => !marked(view, "b"));
    expect(text(outputEl(view, "b"))).toContain("again-b");
    expect(runBelowButtons(outputEl(view, "b"))).toHaveLength(0);
  });

  it("2.3b keeps the rerun cell clear after the view settles", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    await rerun([view], "b", "python-3.12", CODES.b);
    await until(() => !marked(view, "b"));
    await settle(150);
    expect(marked(view, "b")).toBe(false);
  });

  it("2.3b serialises the body exactly as a view without the plugin does after the edit", async () => {
    const { view, plain } = await mountPair(jest.fn());
    editCode([view, plain], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    expect(body(view)).toBe(body(plain));
    expect(view.state.doc.eq(plain.state.doc)).toBe(true);
  });

  it("2.3b serialises the body exactly as a view without the plugin does after the rerun", async () => {
    const { view, plain } = await mountPair(jest.fn());
    editCode([view, plain], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    await rerun([view, plain], "b", "python-3.12", CODES.b);
    await until(() => !marked(view, "b"));
    expect(body(view)).toBe(body(plain));
  });

  it("2.3b does not put the caption text into the serialised body", async () => {
    const { view } = await mountPair(jest.fn());
    editCode([view], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    expect(body(view)).not.toContain("May be out of date");
    expect(body(view)).not.toContain("Run below");
  });

  it("2.3b leaves the document untouched when only the marking happens", async () => {
    const { view } = await mountPair(jest.fn());
    const before = body(view);
    await settle(150);
    expect(body(view)).toBe(before);
  });
});

describe("2.3 the whole cascade", () => {
  it("A4 marks later python, spares mathematica, clears on rerun, and leaves the body as a plain view has it", async () => {
    const onRunBelow = jest.fn();
    const { view, plain } = await mountPair(onRunBelow);
    editCode([view, plain], "a", "x = 10\n");
    await until(() => marked(view, "b"));
    await settle();
    expect(marked(view, "c")).toBe(false);
    expect(runBelowButtons(outputEl(view, "b"))).toHaveLength(1);
    await rerun([view, plain], "b", "python-3.12", CODES.b);
    await until(() => !marked(view, "b"));
    expect(body(view)).toBe(body(plain));
    expect(onRunBelow).not.toHaveBeenCalled();
  });
});
