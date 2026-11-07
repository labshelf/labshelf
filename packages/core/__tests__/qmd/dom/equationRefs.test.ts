/** @jest-environment jsdom */
/** Tests equation numbers in the editor: "(n)" on labelled display equations and references, updated live, and unknown references. */
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bodyToDoc, qmdSchema } from "../../../src/qmd/editor/index";
import { createEquationRefView, equationNumbersPlugin } from "../../../src/qmd/dom/equationRefs";
import { createMathView } from "../../../src/qmd/dom/mathView";

const neverLoads = (): Promise<never> => new Promise(() => undefined);

function mountBody(body: string, reveal = jest.fn()): { view: EditorView; reveal: jest.Mock } {
  const view = new EditorView(document.body.appendChild(document.createElement("div")), {
    state: EditorState.create({ schema: qmdSchema, doc: bodyToDoc(body), plugins: [equationNumbersPlugin()] }),
    nodeViews: { math_display: createMathView(true, neverLoads), eq_ref: createEquationRefView(reveal) },
  });
  return { view, reveal };
}

const texts = (view: EditorView, selector: string): string[] => Array.from(view.dom.querySelectorAll(selector)).map((node) => (node as HTMLElement).hidden ? "" : node.textContent ?? "");

describe("equation numbers", () => {
  const body = "See @eq-b and @eq-nope.\n\n$$\na\n$$ {#eq-a}\n\n$$\nu\n$$\n\n$$\nb\n$$ {#eq-b}\n";

  it("numbers labelled equations and shows references as (n), an unknown one as its source", () => {
    const { view } = mountBody(body);
    expect(texts(view, ".qmd-math-number")).toEqual(["(1)", "", "(2)"]);
    const refs = Array.from(view.dom.querySelectorAll<HTMLElement>(".qmd-eq-ref"));
    expect(refs.map((ref) => ref.textContent)).toEqual(["(2)", "@eq-nope"]);
    expect(refs[1]!.classList.contains("is-unknown")).toBe(true);
    expect(refs[1]!.title).toMatch(/no equation has the label eq-nope/i);
    view.destroy();
  });

  it("renumbers live when a labelled equation is removed", () => {
    const { view } = mountBody(body);
    let first = -1;
    view.state.doc.forEach((node, offset) => { if (node.attrs.label === "eq-a") first = offset; });
    view.dispatch(view.state.tr.delete(first, first + view.state.doc.nodeAt(first)!.nodeSize));
    expect(texts(view, ".qmd-math-number")).toEqual(["", "(1)"]);
    expect(view.dom.querySelector(".qmd-eq-ref")!.textContent).toBe("(1)");
    view.destroy();
  });

  it("reveals the equation a clicked reference points to", () => {
    const { view, reveal } = mountBody(body);
    view.dom.querySelector<HTMLElement>(".qmd-eq-ref")!.click();
    const pos = reveal.mock.calls[0]![1] as number;
    expect(view.state.doc.nodeAt(pos)?.attrs.label).toBe("eq-b");
    view.dom.querySelectorAll<HTMLElement>(".qmd-eq-ref")[1]!.click();
    expect(reveal).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});
