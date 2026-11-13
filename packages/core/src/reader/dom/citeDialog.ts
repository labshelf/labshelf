// The reader's cite popup (plan reader-cite-popup D3): pick a project and one of its source files, click where the
// citation goes in the read-only source, see it there and Insert; the host writes it. Without a passage it can only add
// the paper to the project's bibliography. Copy needs no project: it copies the passage with its citation, or without a
// passage the bare Pandoc citation, through the reader's existing copy messages; it is the only action left when the host
// lists no project or cannot cite. The same popup inserts a linked code listing instead (`code` options): the host builds the
// listing for each file it reads, the popup shows it on lines of its own at the clicked place, and Copy copies it.
import { renderElement, renderPickerDialog, renderTextButton, showToast } from "../../ui/dom/index.js";
import { createReaderCitation, type CiteProject, type CiteReply } from "../../writing/citations/index.js";
import { placeBlockAt } from "../../writing/noteLinks/index.js";
import type { ProjectFormat } from "../../writing/project/index.js";
import { MAX_CITE_QUOTE_LENGTH, type WebviewToHost } from "../protocol/index.js";
import type { CiteClient } from "./citeClient.js";

/** The read-only source view the popup shows; `onPlace` receives the document offset of each caret the user places. */
export interface CiteSourceView {
  readonly element: HTMLElement;
  /** Replaces the text and forgets the caret and the citation. */
  show(text: string, format: ProjectFormat): void;
  /** Shows `text` at the placed caret; null removes it. */
  setCitation(text: string | null): void;
  focus(): void;
  destroy(): void;
}

export type CreateCiteSourceView = (onPlace: (offset: number) => void) => CiteSourceView;

/** The project and file last chosen, kept by the caller for the reader's life. */
export interface CiteChoiceMemory { projectId?: string; path?: string }

interface DialogOptions {
  client: CiteClient;
  memory: CiteChoiceMemory;
  /** Loads the source view; the default imports citeSourceView.ts as a lazy chunk. */
  loadSourceView?: () => Promise<CreateCiteSourceView>;
  /** Shows the success notice; the default is a toast. */
  notify?: (message: string) => void;
  /** Runs once when the popup closes, whatever closed it. */
  onClose?: () => void;
}

export interface CiteDialogOptions extends DialogOptions {
  citeKey: string;
  page?: number | undefined;
  quote?: string | undefined;
  /** Posts Copy's clipboard request to the host. */
  post: (message: Extract<WebviewToHost, { command: "copyWithCitation" | "copyCitation" }>) => void;
}

/** The popup inserting a code listing; the host answers each `read` with the listing built for that file. */
export interface CodeInsertDialogOptions extends DialogOptions {
  code: {
    /** What is inserted, shown beside the title (`fit_model in fit.py`). */
    label: string;
    /** Puts the listing on the clipboard. */
    copy(listing: string): void;
  };
}

const loadDefaultSourceView = async (): Promise<CreateCiteSourceView> => (await import("./citeSourceView.js")).createCiteSourceView;

function renderSelect(label: string): HTMLSelectElement {
  return renderElement("select", { class: "rd-cite-dialog-select", "aria-label": label });
}

function fillOptions(select: HTMLSelectElement, entries: ReadonlyArray<{ value: string; label: string }>, selected: string | undefined): void {
  select.replaceChildren(...entries.map((entry) => renderElement("option", { value: entry.value }, entry.label)));
  if (selected !== undefined) { select.value = selected; }
}

/** What the options say, worked out once: a cite popup or a code insert popup, with its texts. */
interface CiteConfig {
  code: CodeInsertDialogOptions["code"] | undefined;
  cite: CiteDialogOptions | undefined;
  page: number | undefined;
  quote: string | undefined;
  heading: string;
  hint: string;
  noProject: string;
  notify: (message: string) => void;
}

function deriveConfig(options: CiteDialogOptions | CodeInsertDialogOptions): CiteConfig {
  const code = "code" in options ? options.code : undefined;
  const cite = "code" in options ? undefined : options;
  return {
    code, cite, page: cite?.page,
    quote: cite?.quote?.trim() ? cite.quote.slice(0, MAX_CITE_QUOTE_LENGTH) : undefined,
    heading: cite ? `Cite ${cite.citeKey}` : "Insert code into a manuscript",
    hint: `Click in the text where ${cite ? "the citation" : "the code"} goes`,
    noProject: cite ? "No writing project to cite in" : "No writing project to insert into",
    notify: options.notify ?? ((message: string) => { showToast(message, "ok"); }),
  };
}

/** The file read, with its text and, for code, the listing built for it. */
type CiteSource = { path: string; version: string; text: string; listing?: string };

/** One open cite (or code insert) popup. */
class CiteDialog {
  private readonly config: CiteConfig;
  private readonly projectSelect = renderSelect("Project");
  private readonly fileSelect = renderSelect("File");
  private readonly quoteBox = renderElement("input", { type: "checkbox", checked: true });
  private readonly quoteField = renderElement("label", { class: "rd-cite-dialog-check" }, this.quoteBox, "With the quotation");
  private readonly copy = renderTextButton("Copy");
  private readonly onlyAdd = renderTextButton("Only add to the bibliography");
  private readonly cancel = renderTextButton("Cancel");
  private readonly insert = renderTextButton("Insert", "rd-btn-primary");
  private readonly dialog: ReturnType<typeof renderPickerDialog>;
  private readonly sourceView: Promise<CiteSourceView | undefined>;

  private projects: CiteProject[] = [];
  private current: CiteProject | undefined;
  private source: CiteSource | undefined;
  private offset: number | null = null;
  private view: CiteSourceView | undefined;
  private busy = false;
  private closed = false;
  // Each read gets a number, so a late reply of a file the user has left is dropped.
  private readSeq = 0;

  constructor(private readonly options: CiteDialogOptions | CodeInsertDialogOptions) {
    this.config = deriveConfig(options);
    this.dialog = this.renderDialog();
    this.sourceView = this.loadSourceView();
    this.wire();
    this.dialog.showStatus("Loading projects…");
    this.refresh();
    void this.loadTargets();
  }

  close = (): void => {
    if (this.closed) { return; }
    this.closed = true;
    this.dialog.close();
    this.view?.destroy();
    this.options.onClose?.();
  };

  private renderDialog(): ReturnType<typeof renderPickerDialog> {
    const { code, quote, page, heading } = this.config;
    return renderPickerDialog({
      heading, badges: [...(page === undefined ? [] : [`p. ${page}`]), ...(code ? [code.label] : [])],
      pickers: [{ label: "Project", control: this.projectSelect }, { label: "File", control: this.fileSelect }],
      leading: [this.copy, ...(code ? [] : quote === undefined ? [this.onlyAdd] : [this.quoteField])], trailing: [this.cancel, this.insert],
      onDismiss: () => {
        this.closed = true;
        this.view?.destroy();
        this.options.onClose?.();
      },
    });
  }

  private loadSourceView(): Promise<CiteSourceView | undefined> {
    return (this.options.loadSourceView ?? loadDefaultSourceView)().then((create) => {
      if (this.closed) { return undefined; }
      const view = create((placed) => {
        this.offset = placed;
        this.dialog.showStatus(this.config.hint);
        this.refresh();
      });
      this.view = view;
      this.dialog.body.append(view.element);
      return view;
    });
  }

  private wire(): void {
    this.projectSelect.addEventListener("change", () => this.selectProject(this.projectSelect.value));
    this.fileSelect.addEventListener("change", () => {
      this.options.memory.path = this.fileSelect.value;
      void this.readFile(this.fileSelect.value);
    });
    this.quoteBox.addEventListener("change", () => this.refresh());
    this.insert.addEventListener("click", () => this.doInsert());
    this.onlyAdd.addEventListener("click", () => this.doOnlyAdd());
    this.copy.addEventListener("click", () => this.doCopy());
    this.cancel.addEventListener("click", this.close);
    this.dialog.content.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.doInsert();
      }
    });
  }

  private citation(): string | null {
    const { current, offset, source } = this;
    const { cite, page, quote } = this.config;
    if (!current || offset === null) { return null; }
    if (cite) { return createReaderCitation(current.format, cite.citeKey, { page, quote }, quote !== undefined && this.quoteBox.checked); }
    return source?.listing === undefined ? null : placeBlockAt(source.text, offset, source.listing);
  }

  private refresh(): void {
    const { busy, current, source, projects } = this;
    const { code, quote } = this.config;
    this.insert.disabled = busy || !source || this.offset === null;
    this.onlyAdd.disabled = busy;
    this.copy.disabled = busy || (code !== undefined && source?.listing === undefined);
    this.onlyAdd.hidden = code !== undefined || quote !== undefined || !current || current.inBibliography;
    if (current) { this.onlyAdd.textContent = `Only add to ${current.bibliography}`; }
    this.projectSelect.disabled = busy || projects.length === 0;
    this.fileSelect.disabled = busy || !current || current.files.length === 0;
    this.view?.setCitation(this.citation());
  }

  private async readFile(path: string): Promise<void> {
    const { current } = this;
    if (!current) { return; }
    const { code } = this.config;
    const { showStatus } = this.dialog;
    const seq = ++this.readSeq;
    const format = current.format;
    this.source = undefined;
    this.offset = null;
    showStatus(`Reading ${path}…`);
    this.refresh();
    const [reply, shown] = await Promise.all([this.options.client.request({ kind: "read", projectId: current.id, path }), this.sourceView]);
    if (this.closed || seq !== this.readSeq) { return; }
    if (reply.kind !== "source") {
      showStatus(reply.kind === "error" ? reply.message : `Could not read ${path}`, true);
      return;
    }
    if (code && reply.insert === undefined) {
      showStatus(`Could not build the listing for ${path}`, true);
      return;
    }
    this.source = { path, version: reply.version, text: reply.text, ...(reply.insert === undefined ? {} : { listing: reply.insert }) };
    shown?.show(reply.text, format);
    showStatus(this.config.hint);
    this.refresh();
  }

  private selectProject(id: string, path?: string): void {
    const current = this.projects.find((entry) => entry.id === id);
    this.current = current;
    if (!current) { return; }
    const target = path !== undefined && current.files.includes(path) ? path : current.files[0];
    fillOptions(this.fileSelect, current.files.map((entry) => ({ value: entry, label: entry })), target);
    this.options.memory.projectId = current.id;
    if (target === undefined) {
      this.source = undefined;
      this.offset = null;
      this.dialog.showStatus(`${current.title} has no ${current.format === "typst" ? ".typ" : ".tex"} file`, true);
      this.refresh();
      return;
    }
    this.options.memory.path = target;
    void this.readFile(target);
  }

  private finish(reply: CiteReply, done: (reply: CiteReply) => string | null): void {
    this.busy = false;
    if (this.closed) { return; }
    const message = done(reply);
    if (message !== null) {
      this.config.notify(message);
      this.close();
      return;
    }
    if (reply.kind === "error") { this.dialog.showStatus(reply.message, true); }
    this.refresh();
  }

  private doInsert(): void {
    const { current, source, offset } = this;
    const { cite, page, quote } = this.config;
    if (this.insert.disabled || !current || !source || offset === null) { return; }
    this.busy = true;
    this.refresh();
    void this.options.client.request({
      kind: "insert", projectId: current.id, path: source.path, version: source.version, offset,
      ...(page === undefined ? {} : { page }),
      ...(quote === undefined ? {} : { quote }),
      quoted: quote !== undefined && this.quoteBox.checked,
    }).then((reply) => this.finish(reply, (answer) => {
      if (answer.kind === "inserted") {
        return cite ? `Cited in ${answer.path}` : [`Inserted into ${answer.path}`, answer.hint].filter(Boolean).join(". ");
      }
      if (answer.kind === "error" && answer.stale) {
        // The file changed since it was read: show its new text and ask for the place again.
        void this.readFile(source.path).then(() => { if (!this.closed && this.source) { this.dialog.showStatus(answer.message, true); } });
      }
      return null;
    }));
  }

  private doOnlyAdd(): void {
    const { current } = this;
    if (!current || this.busy) { return; }
    this.busy = true;
    this.refresh();
    void this.options.client.request({ kind: "bibliography", projectId: current.id })
      .then((reply) => this.finish(reply, (answer) => (answer.kind === "listed" ? `Added to ${answer.bibliography}` : null)));
  }

  private doCopy(): void {
    if (this.busy) { return; }
    const { code, cite, page, quote } = this.config;
    if (code) {
      if (this.source?.listing === undefined) { return; }
      code.copy(this.source.listing);
      this.close();
      return;
    }
    cite?.post(quote !== undefined && page !== undefined
      ? { command: "copyWithCitation", text: quote, pageNumber: page }
      : { command: "copyCitation", ...(page === undefined ? {} : { pageNumber: page }) });
    this.close();
  }

  // Without a project only Copy and Cancel remain.
  private showNoProject(): void {
    this.dialog.pickers.hidden = true;
    this.dialog.body.hidden = true;
    this.quoteField.hidden = true;
    this.onlyAdd.hidden = true;
    this.insert.hidden = true;
    // Without a project there is no listing to copy.
    this.copy.hidden = this.config.code !== undefined;
    this.dialog.showStatus(this.config.noProject);
  }

  private async loadTargets(): Promise<void> {
    const reply = await this.options.client.request({ kind: "targets" });
    if (this.closed) { return; }
    // A host without a cite port answers with an error; Copy still works there.
    if (reply.kind !== "targets" || reply.projects.length === 0) {
      this.showNoProject();
      return;
    }
    const { memory } = this.options;
    this.projects = reply.projects;
    const remembered = this.projects.find((entry) => entry.id === memory.projectId) ?? this.projects[0]!;
    fillOptions(this.projectSelect, this.projects.map((entry) => ({ value: entry.id, label: entry.title })), remembered.id);
    this.selectProject(remembered.id, remembered.id === memory.projectId ? memory.path : undefined);
    void this.sourceView.then((shown) => shown?.focus());
  }
}

/**
 * Opens the cite popup over the reader.
 * @returns close, which dismisses the popup without citing
 */
export function openCiteDialog(options: CiteDialogOptions | CodeInsertDialogOptions): { close(): void } {
  const dialog = new CiteDialog(options);
  return { close: dialog.close };
}
