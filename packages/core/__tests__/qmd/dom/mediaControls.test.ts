/** @jest-environment jsdom */
// The layout controls of an image: the width field commits one percentage width (10 at least, none at 100), Escape puts
// the saved width back, the alignment buttons write fig-align, the controls sit in the full-width row outside the sized box,
// and a read-only editor has none.
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, history } from "prosemirror-history";
import { createImageView } from "../../../src/qmd/dom/imageView.js";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc.js";

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(body: string, editable = true): { view: EditorView; row: HTMLElement; box: HTMLElement; input: HTMLInputElement | null } {
  const host = document.createElement("div");
  document.body.append(host);
  view = new EditorView(host, { state: EditorState.create({ doc: bodyToDoc(body), plugins: [history()] }), editable: () => editable, nodeViews: { image: createImageView() } });
  const row = host.querySelector<HTMLElement>(".qmd-image")!;
  return { view, row, box: row.querySelector<HTMLElement>(".qmd-media-box")!, input: row.querySelector<HTMLInputElement>(".qmd-width-input") };
}

const type = (input: HTMLInputElement, value: string) => {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (row: HTMLElement, title: string) => row.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;

describe("media controls", () => {
  it("previews a typed width and commits it once on Enter, one undoable step", () => {
    const { view, box, input } = mount("See ![a](x.png){#fig-a} here.\n");
    expect(input!.value).toBe("100");
    type(input!, "40");
    expect(box.style.getPropertyValue("--qmd-media-width")).toBe("40%");
    expect(docToBody(view.state.doc)).toBe("See ![a](x.png){#fig-a} here.\n");
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(docToBody(view.state.doc)).toBe("See ![a](x.png){#fig-a width=40%} here.\n");
    undo(view.state, view.dispatch);
    expect(docToBody(view.state.doc)).toBe("See ![a](x.png){#fig-a} here.\n");
  });

  it("removes the width at 100 % and keeps 10 % as the floor", () => {
    const { view, input } = mount("![a](x.png){width=50%}\n");
    type(input!, "120");
    input!.dispatchEvent(new Event("change"));
    expect(docToBody(view.state.doc)).toBe("![a](x.png)\n");
    type(input!, "0");
    input!.dispatchEvent(new Event("change"));
    expect(docToBody(view.state.doc)).toBe("![a](x.png){width=10%}\n");
  });

  it("puts the saved width back on Escape and keeps a hand-written width", () => {
    const { view, box, input } = mount("![a](x.png){width=3in}\n");
    expect(box.style.getPropertyValue("--qmd-media-width")).toBe("3in");
    type(input!, "30");
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.style.getPropertyValue("--qmd-media-width")).toBe("3in");
    expect(docToBody(view.state.doc)).toBe("![a](x.png){width=3in}\n");
  });

  it("writes fig-align from the buttons, centre removing it, and shows the pressed one", () => {
    const { view, row, box } = mount("![a](x.png){width=60%}\n");
    expect(box.dataset.align).toBe("center");
    expect(button(row, "Align center").getAttribute("aria-pressed")).toBe("true");
    button(row, "Align left").click();
    expect(docToBody(view.state.doc)).toBe('![a](x.png){width=60% fig-align="left"}\n');
    expect(box.dataset.align).toBe("left");
    expect(button(row, "Align left").getAttribute("aria-pressed")).toBe("true");
    button(row, "Align center").click();
    expect(docToBody(view.state.doc)).toBe("![a](x.png){width=60%}\n");
  });

  it("keeps the controls in the full-width row, outside the sized box", () => {
    const { row, box } = mount("![a](x.png){width=60%}\n");
    const controls = row.querySelector<HTMLElement>(".qmd-media-controls")!;
    expect(controls.parentElement).toBe(row);
    expect(box.contains(controls)).toBe(false);
  });

  it("does not let a click on the controls reach the editor", () => {
    const { row } = mount("![a](x.png)\n");
    const seen = jest.fn();
    row.parentElement!.addEventListener("mousedown", seen);
    row.parentElement!.addEventListener("click", seen);
    button(row, "Align right").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it("shows the layout without controls in a read-only editor", () => {
    const { row, box, input } = mount("![a](x.png){width=60% fig-align=\"right\"}\n", false);
    expect(input).toBeNull();
    expect(row.querySelector(".qmd-media-controls")).toBeNull();
    expect(box.classList.contains("has-width")).toBe(true);
    expect(box.dataset.align).toBe("right");
  });
});
