/** @jest-environment jsdom */
// Checks that the Add comment popover quotes the selection only when asked to (a selection does, a line's gutter '+' does not).
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { askCommentBody, type MountBodyEditor } from "../../../src/collab/dom/commentPopover";

const stubEditor: MountBodyEditor = () => ({ setBody: () => {}, focus: () => {}, destroy: () => {} }) as unknown as ReturnType<MountBodyEditor>;

function open(withQuote: boolean): { view: EditorView; done: Promise<string | undefined> } {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc: "one\ntwo\n" }) });
  return { view, done: askCommentBody(view, { start: 4, end: 7 }, stubEditor, withQuote) };
}

afterEach(() => { document.body.innerHTML = ""; });

it("quotes the selected text of a comment on a selection", async () => {
  const { view, done } = open(true);
  expect(document.querySelector(".ls-note-popover-quote")!.textContent).toBe("two");
  // The same card as the reader's floating note: its title and corner grip.
  expect(document.querySelector(".ls-note-popover-title")!.textContent).toBe("Comment");
  expect(document.querySelector(".ls-note-popover-resize")).not.toBeNull();
  document.querySelector<HTMLButtonElement>('.ls-note-popover button[aria-label="Close"]')!.click();
  await expect(done).resolves.toBeUndefined();
  view.destroy();
});

it("quotes nothing for a comment from a line's gutter '+'", async () => {
  const { view, done } = open(false);
  expect(document.querySelector(".ls-note-popover")).not.toBeNull();
  expect(document.querySelector(".ls-note-popover-quote")).toBeNull();
  document.querySelector<HTMLButtonElement>('.ls-note-popover button[aria-label="Close"]')!.click();
  await expect(done).resolves.toBeUndefined();
  view.destroy();
});
