/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the shared code view: the language picked by file extension, read-only versus editable mounting, extra extensions
// appended last, the aria label, and syntax highlighting. 8.1-e (the codePickDialog tests still pass) is covered by the
// existing codePickDialog.test.ts, run alongside this file by the spec's test command.
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { codeViewLanguage, createCodeView } from "../../../../src/writing/dom/sourceEditor/codeView";

const isNonEmpty = (extension: Extension): boolean => (Array.isArray(extension) ? extension.length > 0 : extension !== undefined && extension !== null);

const views: EditorView[] = [];

function mount(options: Parameters<typeof createCodeView>[1]): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = createCodeView(parent, options);
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) { view.destroy(); }
  document.body.innerHTML = "";
});

describe("8.1 packages/core/src/writing/dom/sourceEditor/codeView.ts gives one CodeMirror code view (line numbers, highlighting by file extension, read-only or editable with extra extensions) that codePickDialog's viewer and the consult windows share.", () => {
  it.each(["a.py", "a.tex", "a.typ", "a.R", "a.sh"])("8.1-a (A12) codeViewLanguage returns a non-empty extension for %s", (path) => {
    expect(isNonEmpty(codeViewLanguage(path))).toBe(true);
  });

  it.each(["a.md", "a.qmd", "a.unknown"])("8.1-a (A12) codeViewLanguage returns [] for %s without throwing", (path) => {
    expect(() => codeViewLanguage(path)).not.toThrow();
    expect(codeViewLanguage(path)).toEqual([]);
  });

  it("8.1-b createCodeView with readOnly: true refuses a user edit (state.readOnly true, contentEditable false)", () => {
    const view = mount({ path: "a.py", text: "x = 1\n", readOnly: true });
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(view.state.doc.toString()).toBe("x = 1\n");
  });

  it("8.1-b createCodeView with readOnly: false lets a dispatched user insert change the doc", () => {
    const view = mount({ path: "a.py", text: "x = 1\n", readOnly: false });
    expect(view.state.readOnly).toBe(false);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");
    view.dispatch({ changes: { from: 0, insert: "y = 2\n" }, userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("y = 2\nx = 1\n");
  });

  it("8.1-b createCodeView mounts the view inside the parent with the given text", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createCodeView(parent, { path: "a.txt", text: "hello", readOnly: true });
    views.push(view);
    expect(parent.contains(view.dom)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
    expect(parent.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("8.1-c createCodeView appends options.extensions: an updateListener passed in sees the changes", () => {
    const seen: string[] = [];
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) { seen.push(update.state.doc.toString()); } });
    const view = mount({ path: "a.py", text: "a", readOnly: false, extensions: [listener] });
    view.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input.type" });
    expect(seen).toEqual(["ab"]);
  });

  it("8.1-c createCodeView puts the label in aria-label on the content", () => {
    const view = mount({ path: "a.py", text: "a", readOnly: true, label: "Fit script" });
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Fit script");
  });

  it("8.1-c createCodeView defaults the aria-label to Code", () => {
    const view = mount({ path: "a.py", text: "a", readOnly: true });
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Code");
  });

  it("8.1-d A .py view's content holds highlighted tokens for a 'def f(): return 1' text", () => {
    const view = mount({ path: "a.py", text: "def f(): return 1", readOnly: true });
    const tokens = [...view.contentDOM.querySelectorAll("span")].filter((span) => [...span.classList].some((name) => name.startsWith("tok-") || name.startsWith("ͼ")));
    expect(tokens.length).toBeGreaterThan(0);
  });
});
