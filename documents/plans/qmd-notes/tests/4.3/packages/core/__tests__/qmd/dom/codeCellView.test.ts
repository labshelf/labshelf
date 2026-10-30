/** @jest-environment jsdom */
/**
 * Tests the output node view of the Markdown item editor: it is marked out of date exactly when the hash of its cell code differs from its `source`.
 */
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
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
