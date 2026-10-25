/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The Add comment button leaves focus on the input box it opens, so typing never reaches the editor.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { addCommentSupport } from "../../../src/collab/comments/createCommentSupport";

describe("add comment button", () => {
  it("leaves focus on the opened input box, not the editor", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const input = document.createElement("input");
    document.body.append(input);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 }, extensions: [addCommentSupport(() => input.focus())] }),
    });
    parent.querySelector<HTMLButtonElement>(".ls-add-comment")!.click();
    expect(document.activeElement).toBe(input);
    view.destroy();
  });
});
