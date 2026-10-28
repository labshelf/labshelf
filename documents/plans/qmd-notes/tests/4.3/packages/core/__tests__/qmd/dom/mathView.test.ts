/** @jest-environment jsdom */
/**
 * Tests the math node view of the Markdown item editor: rendering through a stubbed loader and the parse error state.
 */
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { createMathView } from "../../../src/qmd/dom/mathView";
import { mount, until, para, text } from "../../support/nodeViewHarness";

type MathModule = { renderMathSvg(tex: string, display: boolean): string };

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
