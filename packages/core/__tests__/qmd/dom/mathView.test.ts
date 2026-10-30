/** @jest-environment jsdom */
/**
 * Tests the math node view of the Markdown item editor: rendering through a stubbed loader and the parse error state.
 */
import { NodeSelection } from "prosemirror-state";
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


describe("LaTeX editing", () => {
  const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

  function selected() {
    const view = mount(s.node("doc", null, [s.node("math_display", { tex: "x^2" }), para(text("Continue"))]), { math_display: createMathView(true, async () => ({ renderMathSvg: () => SVG })) });
    view.dom.querySelector<HTMLElement>(".qmd-math-rendered")!.click();
    return view;
  }

  it("keeps selected equations typeset until editing is requested", () => {
    const view = mount(s.node("doc", null, [s.node("math_display", { tex: "x^2" }), para(text("Continue"))]), { math_display: createMathView(true, async () => ({ renderMathSvg: () => SVG })) });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
    view.focus();
    expect(view.dom.querySelector("textarea")).toBeNull();
  });

  it("edits display equations in a field attached to the equation and finishes on Enter", () => {
    const view = selected();
    const input = view.dom.querySelector<HTMLTextAreaElement>('.qmd-math-display textarea[aria-label="TeX source"]')!;
    expect(input).not.toBeNull();
    expect(view.dom.querySelector(".qmd-math-hint")!.textContent).toMatch(/Esc/);
    input.value = "x^2 +\ny^2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view.state.doc.firstChild!.attrs.tex).toBe("x^2 +\ny^2");
    key(input, { key: "Enter" });
    expect(view.state.doc.firstChild!.attrs.tex).toBe("x^2 +\ny^2");
    expect(view.dom.querySelector(".qmd-math-edit")).toBeNull();
  });

  it("keeps Shift-Enter for a new line in a display equation", () => {
    const view = selected();
    const input = view.dom.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(key(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(view.dom.querySelector(".qmd-math-edit")).not.toBeNull();
  });

  it("cancels the source edit on Escape without leaving the changed equation behind", () => {
    const view = selected();
    const input = view.dom.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = "changed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    key(input, { key: "Escape" });
    expect(view.state.doc.firstChild!.attrs.tex).toBe("x^2");
    expect(view.dom.querySelector(".qmd-math-edit")).toBeNull();
  });

  it("shows a placeholder for an empty equation and removes it when left empty", () => {
    const view = mount(s.node("doc", null, [s.node("math_display", { tex: "" }), para(text("Continue"))]), { math_display: createMathView(true, async () => ({ renderMathSvg: () => SVG })) });
    expect(view.dom.querySelector(".qmd-math-placeholder")!.textContent).toMatch(/empty equation/i);
    view.dom.querySelector<HTMLElement>(".qmd-math-rendered")!.click();
    key(view.dom.querySelector("textarea")!, { key: "Enter" });
    expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
  });

  it("shows the parse error message as text while editing", async () => {
    const loadMath = async (): Promise<MathModule> => ({ renderMathSvg: () => { throw new Error("Missing close brace"); } });
    const view = mount(s.node("doc", null, [s.node("math_display", { tex: "\\frac{1" })]), { math_display: createMathView(true, loadMath) });
    await until(() => view.dom.querySelector(".qmd-math-error-message") !== null);
    expect(view.dom.querySelector(".qmd-math-error-message")!.textContent).toBe("Missing close brace");
    view.dom.querySelector<HTMLElement>(".qmd-math-rendered")!.click();
    view.dom.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => view.dom.querySelector<HTMLElement>(".qmd-math-edit-error")?.hidden === false);
    expect(view.dom.querySelector(".qmd-math-edit-error")!.textContent).toBe("Missing close brace");
  });
});
