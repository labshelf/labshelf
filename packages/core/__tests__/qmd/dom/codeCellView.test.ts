/** @jest-environment jsdom */
/**
 * Tests the output node view of the Markdown item editor: it is marked out of date exactly when the hash of its cell code differs from its `source`.
 */
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView, createOutputView } from "../../../src/qmd/dom/codeCellView";
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
  expect(view.dom.querySelector(".qmd-output-heading")!.textContent).toBe("Result");
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

it("collapses code without changing the stored cell", async () => {
  const view = mount(await outputDoc(await deriveCodeHash(CODE)), outputViews());
  view.dom.querySelector<HTMLButtonElement>(".qmd-cell-toggle")!.click();
  expect(view.dom.querySelector<HTMLElement>(".qmd-cell-code")!.hidden).toBe(true);
  expect(view.state.doc.firstChild!.attrs.code).toBe(CODE);
  view.dom.querySelector<HTMLButtonElement>(".qmd-cell-toggle")!.click();
  expect(view.dom.querySelector<HTMLElement>(".qmd-cell-code")!.hidden).toBe(false);
});


it("expands a plot into an accessible preview and closes it", () => {
  const raw = formatOutput({ cell: "plot", source: "s", engine: "python", ran: "2026-10-30", content: "![Python plot](data:image/png;base64,iVBORw0KGgo=)" });
  const view = mount(s.node("doc", null, [s.node("output", { raw })]), outputViews());
  view.dom.querySelector<HTMLButtonElement>('[aria-label="Expand plot"]')!.click();
  expect(document.querySelector('[role="dialog"][aria-label="Python plot"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[aria-label="Close plot"]')!.click();
  expect(document.querySelector(".qmd-plot-preview")).toBeNull();
});
