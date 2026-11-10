// The Insert code popup of the source editor, the reader's cite popup inverted: pick a code file, see its code read-only
// with line numbers, select whole lines with the mouse (or nothing for the whole file), read what will be inserted, Insert.
// Browse… (where the host can show a file dialog) adds a code file from anywhere on the machine to the list.
// CONTRACT: documents/contracts/library-format.md#code-listings
import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, lineNumbers } from "@codemirror/view";
import { describeAnchor, excerptFromLines, readCodeExcerpt, type CodeExcerpt, type CodeLinkSource } from "../../codeLinks/index.js";
import { mountCombobox, readPageNonce, renderElement, renderPickerDialog, renderTextButton } from "../../../ui/dom/index.js";
import { editorTheme } from "./editorTheme.js";

/** Where the popup lists and reads code files: paths relative to the project folder. */
export type CodePickSource = CodeLinkSource & {
  /** The code files Insert code offers, relative to the project folder (`../analysis/fit.py`), those inside the project first. */
  list(): Promise<string[]>;
  /**
   * Lets the user pick any code file on the machine and answers its path relative to the project folder, undefined when
   * cancelled or refused; a host without a file dialog leaves it out and the popup shows no Browse… button.
   */
  browse?(): Promise<string | undefined>;
};

/** The file last picked and the files added with Browse…, kept by the caller for its editor's life. */
export interface CodePickMemory { path?: string; browsed?: string[] }

/** The 0-based lines the selection covers; a selection ending at a line's start does not take that line. Null without a selection. */
function selectedLines(state: EditorState): { start: number; end: number } | null {
  const { from, to } = state.selection.main;
  if (from === to) { return null; }
  const start = state.doc.lineAt(from).number - 1;
  const last = state.doc.lineAt(to);
  return { start, end: last.from === to && last.number - 1 > start ? last.number - 2 : last.number - 1 };
}

/** Marks every line the selection takes, since whole lines are inserted. */
const selectedLineMarks = EditorView.decorations.compute(["selection"], (state) => {
  const lines = selectedLines(state);
  if (!lines) { return Decoration.none; }
  const mark = Decoration.line({ class: "ls-code-pick-line" });
  const ranges = [];
  for (let line = lines.start; line <= lines.end; line++) { ranges.push(mark.range(state.doc.line(line + 1).from)); }
  return Decoration.set(ranges);
});

function codeExtensions(onSelect: () => void): Extension[] {
  return [
    EditorView.cspNonce.of(readPageNonce()),
    EditorView.contentAttributes.of({ "aria-label": "Code; select the lines to insert, or nothing for the whole file" }),
    EditorState.readOnly.of(true),
    lineNumbers(), drawSelection(), editorTheme, selectedLineMarks,
    EditorView.updateListener.of((update) => { if (update.selectionSet || update.docChanged) { onSelect(); } }),
  ];
}

/**
 * Opens the Insert code popup.
 * @returns the excerpt to insert, or undefined when the popup was closed without inserting
 */
export function pickCodeExcerpt(source: CodePickSource, memory: CodePickMemory): Promise<CodeExcerpt | undefined> {
  return new Promise((resolve) => {
    let shown: { path: string; text: string } | undefined;
    let done = false;
    let readSeq = 0;
    let listed: string[] = [];
    const editor = renderElement("div", { class: "rd-cite-dialog-editor ls-code-pick-view" });
    const finish = (excerpt: CodeExcerpt | undefined): void => {
      if (done) { return; }
      done = true;
      view.destroy();
      resolve(excerpt);
    };
    const picker = mountCombobox({ label: "Code file", suggestions: [], placeholder: "Type to filter code files", listAll: true, onPick: (picked) => void readFile(picked.value) });
    // The editor hosts load base.css, not the reader's sheet, so the buttons take its classes.
    const cancel = renderTextButton("Cancel", "ls-btn");
    const insert = renderTextButton("Insert", "ls-btn ls-btn-primary");
    const dialog = renderPickerDialog({
      heading: "Insert code", pickers: [{ label: "File", control: picker.root }], leading: [], trailing: [cancel, insert], onDismiss: () => finish(undefined),
    });
    if (source.browse) {
      const browse = renderTextButton("Browse…", "ls-btn");
      browse.title = "Pick a code file anywhere on this computer";
      browse.addEventListener("click", () => void browseFile(source.browse!));
      dialog.pickers.append(browse);
    }
    const excerpt = (): CodeExcerpt | undefined => {
      if (!shown) { return undefined; }
      const lines = selectedLines(view.state);
      return lines ? excerptFromLines(shown.path, shown.text, lines.start, lines.end) : readCodeExcerpt(shown.path, shown.text, { kind: "file" });
    };
    const describe = (): void => {
      const chosen = excerpt();
      insert.disabled = chosen === undefined;
      if (chosen) { dialog.showStatus(chosen.anchor.kind === "file" ? "Whole file" : describeAnchor(chosen.path, chosen.anchor)); }
    };
    const view = new EditorView({ parent: editor, state: EditorState.create({ doc: "", extensions: codeExtensions(describe) }) });
    dialog.body.append(editor);

    async function readFile(path: string): Promise<void> {
      const seq = ++readSeq;
      shown = undefined;
      insert.disabled = true;
      dialog.showStatus(`Reading ${path}…`);
      let text: string | undefined;
      try {
        text = await source.read(path);
      } catch {
        text = undefined;
      }
      if (done || seq !== readSeq) { return; }
      if (text === undefined) { dialog.showStatus(`Could not read ${path}`, true); return; }
      memory.path = path;
      picker.input.value = path;
      shown = { path, text };
      view.setState(EditorState.create({ doc: text, extensions: codeExtensions(describe) }));
      describe();
    }

    /** Lists the browsed files first, then the host's, each once. */
    function showList(paths: readonly string[]): void {
      const browsed = memory.browsed ?? [];
      listed = [...browsed, ...paths.filter((path) => !browsed.includes(path))];
      picker.setSuggestions(listed.map((path) => ({ label: path, value: path })));
    }

    async function browseFile(browse: () => Promise<string | undefined>): Promise<void> {
      let path: string | undefined;
      try {
        path = await browse();
      } catch {
        if (!done) { dialog.showStatus("Could not pick a code file.", true); }
        return;
      }
      if (done || path === undefined) { return; }
      memory.browsed = [path, ...(memory.browsed ?? []).filter((each) => each !== path)];
      showList(listed);
      await readFile(path);
    }

    const doInsert = (): void => {
      const chosen = excerpt();
      if (!chosen) { return; }
      dialog.close();
      finish(chosen);
    };
    cancel.addEventListener("click", () => { dialog.close(); finish(undefined); });
    insert.addEventListener("click", doInsert);
    // Enter inserts, unless the file list took it to pick a file.
    dialog.content.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.defaultPrevented || picker.input.getAttribute("aria-expanded") === "true") { return; }
      event.preventDefault();
      doInsert();
    });

    insert.disabled = true;
    dialog.showStatus("Listing code files…");
    void source.list().then((paths) => {
      if (done) { return; }
      showList(paths);
      if (listed.length === 0) { dialog.showStatus(source.browse ? "No code files found; Browse… for one." : "No code files found.", true); return; }
      if (memory.path !== undefined && listed.includes(memory.path)) {
        void readFile(memory.path);
        view.focus();
        return;
      }
      dialog.showStatus("Pick a code file");
      picker.input.focus();
    }, () => { if (!done) { dialog.showStatus("Could not list the code files.", true); } });
  });
}
