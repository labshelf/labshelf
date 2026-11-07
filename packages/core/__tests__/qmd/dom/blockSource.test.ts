/** @jest-environment jsdom */
/** Tests the current text block as source (plan advanced-notes D16): with Advanced on, a caret moved into a text block shows its Markdown in an editor in its place, edits are read back, and leaving shows it rendered. */
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";
import { blockSourcePlugin } from "../../../src/qmd/dom/blockSource";
import { foldPlugin, setAdvanced } from "../../../src/qmd/dom/foldPlugin";

const BODY = "# Title\n\nSome **bold** and $x^2$ here.\n\nlast\n";
const views: EditorView[] = [];
afterEach(() => { while (views.length) views.pop()!.destroy(); document.body.replaceChildren(); jest.useRealTimers(); });

function mount(advanced: boolean): EditorView {
  const root = document.body.appendChild(document.createElement("div"));
  const view = new EditorView(root, { state: EditorState.create({ doc: bodyToDoc(BODY), plugins: [foldPlugin(), blockSourcePlugin()] }) });
  views.push(view);
  if (advanced) setAdvanced(view, true);
  view.focus();
  return view;
}
/** Moves the caret `offset` characters into the top-level block whose text starts with `start`, and lets the plugin open it. */
async function caretIn(view: EditorView, start: string, offset = 0): Promise<void> {
  let at = 0;
  view.state.doc.forEach((node, pos) => { if (node.textContent.startsWith(start)) at = pos + 1 + offset; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  await Promise.resolve();
}
const source = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(".qmd-block-source-input");

describe("the current text block as source", () => {
  it("shows nothing as source with Advanced off", async () => {
    const view = mount(false);
    await caretIn(view, "Some");
    expect(source()).toBeNull();
  });

  it("shows the Markdown of the block that takes the caret, with its LaTeX, and hides the rendered block", async () => {
    const view = mount(true);
    await caretIn(view, "Some", 5);
    expect(source()!.value).toBe("Some **bold** and $x^2$ here.");
    expect(source()!.selectionStart).toBe(5);
    expect(view.dom.querySelector("p.qmd-source-hidden")).not.toBeNull();
  });

  it("reads the edited source back into the note and shows it rendered after Escape", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    const view = mount(true);
    await caretIn(view, "Some");
    source()!.value = "Some *new* text.";
    source()!.dispatchEvent(new Event("input"));
    jest.advanceTimersByTime(300);
    expect(docToBody(view.state.doc)).toBe("# Title\n\nSome *new* text.\n\nlast\n");
    source()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(source()?.isConnected ?? false).toBe(false);
    expect(view.dom.querySelector(".qmd-source-hidden")).toBeNull();
  });

  it("reads a source that became two blocks back as two blocks", async () => {
    const view = mount(true);
    await caretIn(view, "last");
    source()!.value = "last\n\n## More";
    source()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(docToBody(view.state.doc)).toBe("# Title\n\nSome **bold** and $x^2$ here.\n\nlast\n\n## More\n");
  });
});
