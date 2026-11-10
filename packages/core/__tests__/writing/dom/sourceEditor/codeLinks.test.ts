/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the Open source button over a listing copied from a code file: it shows while the cursor is in the listing and opens the
// file at the definition's current line, or at the file's start when the definition is gone.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeSourceButton, type CodeFileSource } from "../../../../src/writing/dom/sourceEditor/codeLinks";

const MANUSCRIPT = [
  "Intro",
  "% labshelf:code ../analysis/fit.py#residuals @2875f52eacca",
  "\\begin{minted}{python}",
  "def residuals(model, t, observed):",
  "    return observed - model(t)",
  "\\end{minted}",
  "% labshelf:code end",
  "Outro",
].join("\n");

const logger = { log: async () => {}, error: async () => {} } as never;

function mount(file: string | undefined, source: Partial<CodeFileSource> = {}) {
  const open = jest.fn(async (_path: string, _line?: number) => {});
  const deps: CodeFileSource = { read: async () => file, list: async () => [], open, ...source };
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: MANUSCRIPT, extensions: [codeSourceButton("latex", deps, logger)] }) });
  return { view, open, button: () => document.querySelector<HTMLButtonElement>(".ls-code-source") };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("codeSourceButton", () => {
  it("shows in a listing and opens the file at the definition's line", async () => {
    const { view, open, button } = mount("import numpy\n\n\ndef residuals(model, t, observed):\n    return observed - model(t)\n");
    expect(button()!.hidden).toBe(true);
    view.focus();
    view.dispatch({ selection: { anchor: MANUSCRIPT.indexOf("return") } });
    expect(button()!.textContent).toBe("Open source");
    button()!.click();
    await flush();
    expect(open).toHaveBeenCalledWith("../analysis/fit.py", 4);
    view.destroy();
    expect(button()).toBeNull();
  });

  it("opens at the file's start when the definition is gone or the file cannot be read", async () => {
    for (const source of [{ read: async () => "x = 1\n" }, { read: async () => { throw new Error("outside"); } }]) {
      const { view, open, button } = mount(undefined, source);
      view.focus();
      view.dispatch({ selection: { anchor: MANUSCRIPT.indexOf("return") } });
      button()!.click();
      await flush();
      expect(open).toHaveBeenCalledWith("../analysis/fit.py", undefined);
      view.destroy();
    }
  });

  it("adds no button when the host cannot open code files", () => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: MANUSCRIPT, extensions: [codeSourceButton("latex", { read: async () => undefined, list: async () => [] }, logger)] }) });
    expect(document.querySelector(".ls-code-source")).toBeNull();
    view.destroy();
  });
});
