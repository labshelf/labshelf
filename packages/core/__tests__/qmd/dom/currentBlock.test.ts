/** @jest-environment jsdom */
/** Tests the current block (plan advanced-notes D6): with Advanced on and the editor focused, the top-level block holding the caret, or the cell whose code has the focus with its outputs, gets is-current-block. */
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bodyToDoc } from "../../../src/qmd/editor";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { currentBlockPlugin } from "../../../src/qmd/dom/currentBlock";
import { foldPlugin, setAdvanced } from "../../../src/qmd/dom/foldPlugin";

const OUTPUT = '::: {.labshelf-output cell="cell-1" source="abc"}\n```\n1\n```\n:::\n';
const BODY = `first\n\n\`\`\`{python}\nx = 1\n\`\`\`\n\n${OUTPUT}\nlast\n`;

const views: EditorView[] = [];
afterEach(() => { while (views.length) views.pop()!.destroy(); document.body.replaceChildren(); });

function mount(): { root: HTMLElement; view: EditorView } {
  const root = document.body.appendChild(document.createElement("div"));
  const view = new EditorView(root, {
    state: EditorState.create({ doc: bodyToDoc(BODY), plugins: [foldPlugin(), currentBlockPlugin()] }),
    nodeViews: { code_cell: createCodeCellView(), output: createOutputView() },
  });
  views.push(view);
  return { root, view };
}
const current = (root: HTMLElement): string[] => [...root.querySelectorAll(".is-current-block")].map((el) => el.tagName.toLowerCase() + (el.classList.contains("qmd-output") ? ".output" : el.classList.contains("qmd-cell") ? ".cell" : ""));
const focusIn = (target: Element): void => { target.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); };
const caretIn = (view: EditorView, text: string): void => {
  let at = 0;
  view.state.doc.forEach((node, pos) => { if (node.textContent === text) at = pos + 1; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
};

describe("the current block", () => {
  it("marks nothing with Advanced off", () => {
    const { root, view } = mount();
    focusIn(view.dom);
    caretIn(view, "last");
    expect(current(root)).toEqual([]);
  });

  it("marks the paragraph holding the caret while the editor has the focus", () => {
    const { root, view } = mount();
    setAdvanced(view, true);
    focusIn(view.dom);
    caretIn(view, "last");
    expect(current(root)).toEqual(["p"]);
    caretIn(view, "first");
    expect(current(root)).toEqual(["p"]);
    expect(root.querySelector(".is-current-block")!.textContent).toBe("first");
  });

  it("marks a cell and its outputs when the focus is in its code", () => {
    const { root, view } = mount();
    setAdvanced(view, true);
    focusIn(root.querySelector(".qmd-cell .cm-content")!);
    expect(current(root)).toEqual(["div.cell", "div.output"]);
    focusIn(view.dom);
    expect(current(root)).toEqual(["p"]);
  });
});
