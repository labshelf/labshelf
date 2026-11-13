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

/** One open Insert code popup; `resolve` answers `pickCodeExcerpt` once, when it closes. */
class CodePickPopup {
  private shown: { path: string; text: string } | undefined;
  private done = false;
  private readSeq = 0;
  private listed: string[] = [];
  private readonly picker = mountCombobox({ label: "Code file", suggestions: [], placeholder: "Type to filter code files", listAll: true, onPick: (picked) => void this.readFile(picked.value) });
  // The editor hosts load base.css, not the reader's sheet, so the buttons take its classes.
  private readonly cancel = renderTextButton("Cancel", "ls-btn");
  private readonly insert = renderTextButton("Insert", "ls-btn ls-btn-primary");
  private readonly dialog = renderPickerDialog({
    heading: "Insert code", pickers: [{ label: "File", control: this.picker.root }], leading: [], trailing: [this.cancel, this.insert], onDismiss: () => this.finish(undefined),
  });
  private readonly view: EditorView;

  constructor(private readonly source: CodePickSource, private readonly memory: CodePickMemory, private readonly resolve: (excerpt: CodeExcerpt | undefined) => void) {
    const editor = renderElement("div", { class: "rd-cite-dialog-editor ls-code-pick-view" });
    this.view = new EditorView({ parent: editor, state: EditorState.create({ doc: "", extensions: codeExtensions(() => this.describe()) }) });
    this.dialog.body.append(editor);
    this.addBrowse();
    this.wire();
    this.insert.disabled = true;
    this.dialog.showStatus("Listing code files…");
    void source.list().then((paths) => this.onListed(paths), () => { if (!this.done) { this.dialog.showStatus("Could not list the code files.", true); } });
  }

  private addBrowse(): void {
    const { browse } = this.source;
    if (!browse) { return; }
    const button = renderTextButton("Browse…", "ls-btn");
    button.title = "Pick a code file anywhere on this computer";
    button.addEventListener("click", () => void this.browseFile(browse));
    this.dialog.pickers.append(button);
  }

  private wire(): void {
    this.cancel.addEventListener("click", () => { this.dialog.close(); this.finish(undefined); });
    this.insert.addEventListener("click", () => this.doInsert());
    // Enter inserts, unless the file list took it to pick a file.
    this.dialog.content.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.defaultPrevented || this.picker.input.getAttribute("aria-expanded") === "true") { return; }
      event.preventDefault();
      this.doInsert();
    });
  }

  private finish(excerpt: CodeExcerpt | undefined): void {
    if (this.done) { return; }
    this.done = true;
    this.view.destroy();
    this.resolve(excerpt);
  }

  private excerpt(): CodeExcerpt | undefined {
    if (!this.shown) { return undefined; }
    const lines = selectedLines(this.view.state);
    return lines ? excerptFromLines(this.shown.path, this.shown.text, lines.start, lines.end) : readCodeExcerpt(this.shown.path, this.shown.text, { kind: "file" });
  }

  private describe(): void {
    const chosen = this.excerpt();
    this.insert.disabled = chosen === undefined;
    if (chosen) { this.dialog.showStatus(chosen.anchor.kind === "file" ? "Whole file" : describeAnchor(chosen.path, chosen.anchor)); }
  }

  private doInsert(): void {
    const chosen = this.excerpt();
    if (!chosen) { return; }
    this.dialog.close();
    this.finish(chosen);
  }

  private async readFile(path: string): Promise<void> {
    const seq = ++this.readSeq;
    this.shown = undefined;
    this.insert.disabled = true;
    this.dialog.showStatus(`Reading ${path}…`);
    let text: string | undefined;
    try {
      text = await this.source.read(path);
    } catch {
      text = undefined;
    }
    if (this.done || seq !== this.readSeq) { return; }
    if (text === undefined) { this.dialog.showStatus(`Could not read ${path}`, true); return; }
    this.memory.path = path;
    this.picker.input.value = path;
    this.shown = { path, text };
    this.view.setState(EditorState.create({ doc: text, extensions: codeExtensions(() => this.describe()) }));
    this.describe();
  }

  /** Lists the browsed files first, then the host's, each once. */
  private showList(paths: readonly string[]): void {
    const browsed = this.memory.browsed ?? [];
    this.listed = [...browsed, ...paths.filter((path) => !browsed.includes(path))];
    this.picker.setSuggestions(this.listed.map((path) => ({ label: path, value: path })));
  }

  private async browseFile(browse: () => Promise<string | undefined>): Promise<void> {
    let path: string | undefined;
    try {
      path = await browse();
    } catch {
      if (!this.done) { this.dialog.showStatus("Could not pick a code file.", true); }
      return;
    }
    if (this.done || path === undefined) { return; }
    this.memory.browsed = [path, ...(this.memory.browsed ?? []).filter((each) => each !== path)];
    this.showList(this.listed);
    await this.readFile(path);
  }

  private onListed(paths: string[]): void {
    if (this.done) { return; }
    this.showList(paths);
    if (this.listed.length === 0) { this.dialog.showStatus(this.source.browse ? "No code files found; Browse… for one." : "No code files found.", true); return; }
    const { path } = this.memory;
    if (path !== undefined && this.listed.includes(path)) {
      void this.readFile(path);
      this.view.focus();
      return;
    }
    this.dialog.showStatus("Pick a code file");
    this.picker.input.focus();
  }
}

/**
 * Opens the Insert code popup.
 * @returns the excerpt to insert, or undefined when the popup was closed without inserting
 */
export function pickCodeExcerpt(source: CodePickSource, memory: CodePickMemory): Promise<CodeExcerpt | undefined> {
  return new Promise((resolve) => { new CodePickPopup(source, memory, resolve); });
}
