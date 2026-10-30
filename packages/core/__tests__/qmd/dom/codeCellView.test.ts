/** @jest-environment jsdom */
/**
 * Tests the output node view of the Markdown item editor: it is marked out of date exactly when the hash of its cell code differs from its `source`.
 * Also tests that Run on a cell without a `#| label:` line asks the host for `cell-<n>`, the address the host writes the result under.
 */
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { mount, until, settle } from "../../support/nodeViewHarness";

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


it("shows fenced text results without their Markdown delimiters", async () => {
  const raw = formatOutput({ cell: "bound", source: await deriveCodeHash(CODE), engine: "python", ran: "2026-10-30", content: "```text\n42\n```\n" });
  const view = mount(s.node("doc", null, [s.node("output", { raw })]), outputViews());
  expect(view.dom.querySelector(".qmd-output-text")!.textContent).toBe("42");
  expect(view.dom.querySelector(".qmd-output-caption")).toBeNull();
});


it("keeps fenced TeX as literal text instead of changing the result into math", () => {
  const raw = formatOutput({ cell: "bound", source: "s", engine: "python", ran: "2026-10-30", content: "```text\n$$x$$\n```\n" });
  const loadMath = jest.fn(async () => ({ renderMathSvg: () => "<svg></svg>" }));
  const view = mount(s.node("doc", null, [s.node("output", { raw })]), { output: createOutputView(loadMath) });
  expect(view.dom.querySelector(".qmd-output-text")!.textContent).toBe("$$x$$");
  expect(loadMath).not.toHaveBeenCalled();
});


it("renders the stored PNG of a Python plot as an image", () => {
  const src = "data:image/png;base64,iVBORw0KGgo=";
  const raw = formatOutput({ cell: "plot", source: "s", engine: "python", ran: "2026-10-30", content: `![Python plot](${src})` });
  const view = mount(s.node("doc", null, [s.node("output", { raw })]), outputViews());
  const image = view.dom.querySelector<HTMLImageElement>(".qmd-output-image")!;
  expect(image.src).toBe(src);
  expect(image.alt).toBe("Python plot");
  expect(view.dom.querySelector(".qmd-output-text")).toBeNull();
});

describe("a cell with a result reads like a figure", () => {
  const runs: Array<[string, string]> = [];
  const runnable = () => ({ code_cell: createCodeCellView((label, code) => runs.push([label, code])), output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })) });
  const panel = (view: { dom: HTMLElement }) => view.dom.querySelector<HTMLElement>(".qmd-cell-panel")!;
  const line = (view: { dom: HTMLElement }) => view.dom.querySelector<HTMLElement>(".qmd-output-actions");
  const words = (el: Element) => el.textContent!.replace(/\s*·\s*/g, " · ").trim();
  beforeEach(() => { runs.length = 0; });

  it("folds its code away and shows Python · Run again · Show code under its output", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), runnable());
    await until(() => line(view) !== null);
    expect(panel(view).hidden).toBe(true);
    expect(words(line(view)!)).toBe("Python · Run again · Show code");
    expect(view.state.doc.firstChild!.attrs.code).toBe(CODE);
  });

  it("Run again runs the cell and marks it as the one requested", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), runnable());
    await until(() => line(view) !== null);
    line(view)!.querySelector<HTMLButtonElement>(".qmd-output-run")!.click();
    expect(runs).toEqual([["bound", CODE]]);
    expect(view.dom.querySelector(".qmd-cell")!.classList.contains("is-run-requested")).toBe(true);
  });

  it("Show code unfolds the code in place above the output and Hide code folds it again", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), runnable());
    await until(() => line(view) !== null);
    line(view)!.querySelector<HTMLButtonElement>(".qmd-output-code")!.click();
    expect(panel(view).hidden).toBe(false);
    expect(panel(view).closest(".qmd-cell")!.nextElementSibling!.classList.contains("qmd-output")).toBe(true);
    expect(panel(view).querySelector(".cm-content")!.textContent).toBe("print(1)");
    expect(line(view)!.querySelector(".qmd-output-code")!.textContent).toBe("Hide code");
    line(view)!.querySelector<HTMLButtonElement>(".qmd-output-code")!.click();
    expect(panel(view).hidden).toBe(true);
    expect(line(view)!.querySelector(".qmd-output-code")!.textContent).toBe("Show code");
  });

  it("a double click on the output leaves the code folded", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), runnable());
    await until(() => line(view) !== null);
    view.dom.querySelector(".qmd-output-body")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(panel(view).hidden).toBe(true);
  });

  it("Shift-Enter in unfolded code runs it, folds it and moves the caret below the output", async () => {
    const view = mount(s.node("doc", null, [...(await outputDoc(await deriveCodeHash(CODE))).content.content, s.node("paragraph", null, [s.text("after")])]), runnable());
    await until(() => line(view) !== null);
    line(view)!.querySelector<HTMLButtonElement>(".qmd-output-code")!.click();
    panel(view).querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    expect(runs).toEqual([["bound", CODE]]);
    expect(panel(view).hidden).toBe(true);
    expect(view.state.selection.$from.parent.textContent).toBe("after");
  });

  it("omits Run again when the note cannot run cells", async () => {
    const view = mount(await outputDoc(await deriveCodeHash(CODE)), outputViews());
    await until(() => line(view) !== null);
    expect(words(line(view)!)).toBe("Python · Show code");
  });
});


it("expands a plot into an accessible preview and closes it", () => {
  const raw = formatOutput({ cell: "plot", source: "s", engine: "python", ran: "2026-10-30", content: "![Python plot](data:image/png;base64,iVBORw0KGgo=)" });
  const view = mount(s.node("doc", null, [s.node("output", { raw })]), outputViews());
  view.dom.querySelector<HTMLButtonElement>('[aria-label="Expand plot"]')!.click();
  expect(document.querySelector('[role="dialog"][aria-label="Python plot"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[aria-label="Close plot"]')!.click();
  expect(document.querySelector(".qmd-plot-preview")).toBeNull();
});

const bareCell = (code: string, options = "") => s.node("code_cell", { lang: "python", options, code, info: "{python}" });
const META = { ran: "2026-10-30T00:00:00.000Z" };

describe("Run on a cell without a label", () => {
  it("sends cell-<n> for an unlabeled cell, counting every cell of the item", () => {
    const runs: Array<[string, string]> = [];
    const view = mount(s.node("doc", null, [bareCell("a = 1\n"), bareCell("print(2)\n", "#| label: named\n"), bareCell("print(3)\n")]),
      { code_cell: createCodeCellView((label, code) => runs.push([label, code])) });
    const buttons = view.dom.querySelectorAll<HTMLButtonElement>(".qmd-cell-run");
    buttons[2]!.click();
    buttons[1]!.click();
    expect(runs).toEqual([["cell-3", "print(3)\n"], ["named", "print(2)\n"]]);
  });

  it("the label a bare cell sends lets the host store its output", async () => {
    const body = "```{python}\nprint(1)\n```\n";
    const sent: string[] = [];
    const view = mount(s.node("doc", null, [bareCell("print(1)\n")]), { code_cell: createCodeCellView((label) => sent.push(label)) });
    view.dom.querySelector<HTMLButtonElement>(".qmd-cell-run")!.click();
    const next = await writeCellOutput(body, sent[0]!, { status: "ok", language: "python", text: "1", durationMs: 1 }, META);
    expect(next).not.toBe(body);
  });
});

describe("a loaded note's {py} or bare fence is a Python cell", () => {
  const BODIES = { "{py}": "```{py}\nprint(1)\n```\n", bare: "```\nprint(1)\n```\n" };
  const load = (body: string, runs: Array<[string, string, string]>) =>
    mount(bodyToDoc(body), { code_cell: createCodeCellView((label, code, language) => runs.push([label, code, language]), () => undefined) });

  for (const [name, body] of Object.entries(BODIES)) {
    it(`4.3a ${name}: shows Run, the Python picker and Restart, and Run calls onRunCell with python`, () => {
      const runs: Array<[string, string, string]> = [];
      const view = load(body, runs);
      const run = view.dom.querySelector<HTMLButtonElement>(".qmd-cell-run:not(.qmd-cell-restart)");
      expect(run).not.toBeNull();
      expect(view.dom.querySelector(".qmd-cell-lang")!.textContent).toBe("Python");
      expect(view.dom.querySelector(".qmd-cell-restart")).not.toBeNull();
      run!.click();
      expect(runs).toEqual([["cell-1", "print(1)\n", "python"]]);
    });

    it(`4.3b ${name}: serialises unchanged to the same body`, () => {
      const view = load(body, []);
      expect(docToBody(view.state.doc)).toBe(body);
    });
  }

  it("4.3b picking R on the bare cell serialises ```{r}", () => {
    const view = load(BODIES.bare, []);
    view.dom.querySelector<HTMLButtonElement>(".qmd-cell-lang-picker")!.click();
    const r = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent!.trim() === "R")!;
    r.click();
    expect(docToBody(view.state.doc)).toBe("```{r}\nprint(1)\n```\n");
  });
});
