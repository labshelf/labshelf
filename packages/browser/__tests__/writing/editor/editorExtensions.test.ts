/**
 * @jest-environment jsdom
 */
// Pins the shared editor extensions: a snippet's repeated field is typed in all its places at once.
import { snippet } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { editorExtensions } from "../../../src/writing/editor/editorExtensions";

describe("editorExtensions", () => {
  it("types the environment name into both \\begin and \\end of the snippet", () => {
    const view = new EditorView({ doc: "\\", extensions: editorExtensions([], { onSave: () => undefined }), parent: document.body });
    snippet("\\begin{${1:environment}}\n\t${0}\n\\end{${1:environment}}")(view, null, 0, 1);
    view.dispatch(view.state.replaceSelection("itemize"));
    expect(view.state.doc.toString()).toMatch(/^\\begin{itemize}\n\s*\n\\end{itemize}$/);
    view.destroy();
  });
});
