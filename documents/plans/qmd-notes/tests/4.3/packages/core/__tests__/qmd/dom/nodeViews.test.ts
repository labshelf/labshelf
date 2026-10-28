/** @jest-environment jsdom */
/**
 * Tests the ProseMirror node views of the Markdown item editor: task checkbox, output staleness and math rendering.
 */
import { TextEncoder as NodeTextEncoder } from "node:util";
import { EditorState } from "prosemirror-state";
import { EditorView, type NodeViewConstructor } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/cellOutput";
import { createMathView } from "../../../src/qmd/dom/mathView";
import { createCodeCellView, createOutputView } from "../../../src/qmd/dom/codeCellView";
import { createTaskItemView } from "../../../src/qmd/dom/inlineViews";

// jsdom does not expose TextEncoder, which the code hash needs.
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

type MathModule = { renderMathSvg(tex: string, display: boolean): string };

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

function mount(doc: PmNode, nodeViews: Record<string, NodeViewConstructor>): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ doc }), nodeViews });
  views.push(view);
  return view;
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const para = (...content: PmNode[]) => s.node("paragraph", null, content);
const text = (value: string) => s.text(value);

function taskDoc(checked: boolean): PmNode {
  return s.node("doc", null, [
    s.node("bullet_list", null, [s.node("task_item", { checked, mark: "x" }, [para(text("write tests"))])]),
  ]);
}

const taskItem = (view: EditorView): PmNode => view.state.doc.firstChild!.firstChild!;

describe("task item view", () => {
  it("4.3a shows an unchecked task as an unchecked checkbox and a checked one as checked", () => {
    const open = mount(taskDoc(false), { task_item: createTaskItemView() });
    expect(open.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    const done = mount(taskDoc(true), { task_item: createTaskItemView() });
    expect(done.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it("4.3a toggles checked in the document when the checkbox is clicked", () => {
    const view = mount(taskDoc(false), { task_item: createTaskItemView() });
    const box = view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    expect(taskItem(view).attrs.checked).toBe(true);
    expect(taskItem(view).textContent).toBe("write tests");
  });

  it("4.3a toggles checked back when the checkbox is clicked again", () => {
    const view = mount(taskDoc(true), { task_item: createTaskItemView() });
    view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(taskItem(view).attrs.checked).toBe(false);
  });
});

const CODE = "print(1)\n";

async function outputDoc(source: string): Promise<PmNode> {
  const raw = formatOutput({ cell: "bound", source, engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content: "result-text-42\n" });
  return s.node("doc", null, [
    s.node("code_cell", { lang: "python", options: "#| label: bound\n", code: CODE, info: "{python}" }),
    s.node("output", { cell: "bound", source, engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", raw }),
  ]);
}

const OUT_OF_DATE = /out[\s_-]?of[\s_-]?date|outdated|stale/i;
const outputViews = () => ({ code_cell: createCodeCellView(), output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })) });

describe("output view", () => {
  it("4.3b marks an output whose source differs from the hash of its cell code as out of date", async () => {
    const view = mount(await outputDoc("000000000000"), outputViews());
    await until(() => OUT_OF_DATE.test(view.dom.innerHTML));
    expect(view.dom.innerHTML).toMatch(OUT_OF_DATE);
  });

  it("4.3b does not mark an output whose source equals the hash of its cell code", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), outputViews());
    await settle();
    expect(view.dom.innerHTML).not.toMatch(OUT_OF_DATE);
  });

  it("4.3b shows the text of the output", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), outputViews());
    await until(() => (view.dom.textContent ?? "").includes("result-text-42"));
    expect(view.dom.textContent).toContain("result-text-42");
  });

  it("4.3b marks the output once the cell code changes to something its source does not match", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), outputViews());
    await settle();
    expect(view.dom.innerHTML).not.toMatch(OUT_OF_DATE);
    const tr = view.state.tr.setNodeMarkup(0, undefined, { ...view.state.doc.child(0).attrs, code: "print(2)\n" });
    view.dispatch(tr);
    await until(() => OUT_OF_DATE.test(view.dom.innerHTML));
    expect(view.dom.innerHTML).toMatch(OUT_OF_DATE);
  });
});

const SVG = '<svg data-stub="render" style="vertical-align: -0.5ex; color: red"><g style="fill: blue"><path d="M0 0"></path></g></svg>';

function inlineMathDoc(tex: string): PmNode {
  return s.node("doc", null, [para(text("see "), s.node("math_inline", { tex }), text(" here"))]);
}

describe("math view", () => {
  it("4.3c renders inline math through the stubbed loader", async () => {
    const renderMathSvg = jest.fn((_tex: string, _display: boolean) => SVG);
    const loadMath = jest.fn(async (): Promise<MathModule> => ({ renderMathSvg }));
    const view = mount(inlineMathDoc("x^2"), { math_inline: createMathView(false, loadMath) });
    await until(() => view.dom.querySelector("svg[data-stub]") !== null);
    expect(renderMathSvg).toHaveBeenCalledWith("x^2", false);
  });

  it("4.3c renders display math with display set to true", async () => {
    const renderMathSvg = jest.fn((_tex: string, _display: boolean) => SVG);
    const doc = s.node("doc", null, [s.node("math_display", { tex: "a+b", label: "eq-sum" })]);
    const view = mount(doc, { math_display: createMathView(true, async () => ({ renderMathSvg })) });
    await until(() => view.dom.querySelector("svg[data-stub]") !== null);
    expect(renderMathSvg).toHaveBeenCalledWith("a+b", true);
  });

  it("4.3c leaves no style attribute carrying the MathJax styles in the markup", async () => {
    const view = mount(inlineMathDoc("x^2"), { math_inline: createMathView(false, async () => ({ renderMathSvg: () => SVG })) });
    await until(() => view.dom.querySelector("svg[data-stub]") !== null);
    expect(view.dom.innerHTML).not.toMatch(/color:\s*red/);
    expect(view.dom.innerHTML).not.toMatch(/fill:\s*blue/);
  });

  it("4.3c shows the TeX with an error class when the stub throws", async () => {
    const loadMath = async (): Promise<MathModule> => ({ renderMathSvg: () => { throw new Error("Missing close brace"); } });
    const view = mount(inlineMathDoc("\\frac{1"), { math_inline: createMathView(false, loadMath) });
    await until(() => view.dom.querySelector('[class*="error"]') !== null);
    expect(view.dom.querySelector('[class*="error"]')!.textContent).toContain("\\frac{1");
    expect(view.dom.querySelector("svg")).toBeNull();
  });

  it("4.3c shows the error class for display math when the stub throws", async () => {
    const loadMath = async (): Promise<MathModule> => ({ renderMathSvg: () => { throw new Error("bad"); } });
    const doc = s.node("doc", null, [s.node("math_display", { tex: "\\bad{", label: null })]);
    const view = mount(doc, { math_display: createMathView(true, loadMath) });
    await until(() => view.dom.querySelector('[class*="error"]') !== null);
    expect(view.dom.querySelector('[class*="error"]')!.textContent).toContain("\\bad{");
  });
});
