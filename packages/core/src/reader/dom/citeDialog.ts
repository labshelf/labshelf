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

/**
 * Opens the cite popup over the reader.
 * @returns close, which dismisses the popup without citing
 */
export function openCiteDialog(options: CiteDialogOptions | CodeInsertDialogOptions): { close(): void } {
  const { client, memory } = options;
  const code = "code" in options ? options.code : undefined;
  const cite = "code" in options ? undefined : options;
  const page = cite?.page;
  const quote = cite?.quote?.trim() ? cite.quote.slice(0, MAX_CITE_QUOTE_LENGTH) : undefined;
  const heading = cite ? `Cite ${cite.citeKey}` : "Insert code into a manuscript";
  const hint = `Click in the text where ${cite ? "the citation" : "the code"} goes`;
  const noProject = cite ? "No writing project to cite in" : "No writing project to insert into";
  const notify = options.notify ?? ((message: string) => { showToast(message, "ok"); });

  const project = { select: renderSelect("Project") };
  const file = { select: renderSelect("File") };
  const quoteBox = renderElement("input", { type: "checkbox", checked: true });
  const quoteField = renderElement("label", { class: "rd-cite-dialog-check" }, quoteBox, "With the quotation");
  const copy = renderTextButton("Copy");
  const onlyAdd = renderTextButton("Only add to the bibliography");
  const cancel = renderTextButton("Cancel");
  const insert = renderTextButton("Insert", "rd-btn-primary");
  const dialog = renderPickerDialog({
    heading, badges: [...(page === undefined ? [] : [`p. ${page}`]), ...(code ? [code.label] : [])],
    pickers: [{ label: "Project", control: project.select }, { label: "File", control: file.select }],
    leading: [copy, ...(code ? [] : quote === undefined ? [onlyAdd] : [quoteField])], trailing: [cancel, insert],
    onDismiss: () => {
      closed = true;
      view?.destroy();
      options.onClose?.();
    },
  });
  const { content, pickers, body, showStatus } = dialog;

  let projects: CiteProject[] = [];
  let current: CiteProject | undefined;
  /** The file read, with its text and, for code, the listing built for it. */
  let source: { path: string; version: string; text: string; listing?: string } | undefined;
  let offset: number | null = null;
  let view: CiteSourceView | undefined;
  let busy = false;
  let closed = false;
  // Each read gets a number, so a late reply of a file the user has left is dropped.
  let readSeq = 0;

  const citation = (): string | null => {
    if (!current || offset === null) { return null; }
    if (cite) { return createReaderCitation(current.format, cite.citeKey, { page, quote }, quote !== undefined && quoteBox.checked); }
    return source?.listing === undefined ? null : placeBlockAt(source.text, offset, source.listing);
  };
  const refresh = (): void => {
    insert.disabled = busy || !source || offset === null;
    onlyAdd.disabled = busy;
    copy.disabled = busy || (code !== undefined && source?.listing === undefined);
    onlyAdd.hidden = code !== undefined || quote !== undefined || !current || current.inBibliography;
    if (current) { onlyAdd.textContent = `Only add to ${current.bibliography}`; }
    project.select.disabled = busy || projects.length === 0;
    file.select.disabled = busy || !current || current.files.length === 0;
    view?.setCitation(citation());
  };

  const sourceView = (options.loadSourceView ?? loadDefaultSourceView)().then((create) => {
    if (closed) { return undefined; }
    view = create((placed) => {
      offset = placed;
      showStatus(hint);
      refresh();
    });
    body.append(view.element);
    return view;
  });

  const readFile = async (path: string): Promise<void> => {
    if (!current) { return; }
    const seq = ++readSeq;
    const format = current.format;
    source = undefined;
    offset = null;
    showStatus(`Reading ${path}…`);
    refresh();
    const [reply, shown] = await Promise.all([client.request({ kind: "read", projectId: current.id, path }), sourceView]);
    if (closed || seq !== readSeq) { return; }
    if (reply.kind !== "source") {
      showStatus(reply.kind === "error" ? reply.message : `Could not read ${path}`, true);
      return;
    }
    if (code && reply.insert === undefined) {
      showStatus(`Could not build the listing for ${path}`, true);
      return;
    }
    source = { path, version: reply.version, text: reply.text, ...(reply.insert === undefined ? {} : { listing: reply.insert }) };
    shown?.show(reply.text, format);
    showStatus(hint);
    refresh();
  };

  const selectProject = (id: string, path?: string): void => {
    current = projects.find((entry) => entry.id === id);
    if (!current) { return; }
    const target = path !== undefined && current.files.includes(path) ? path : current.files[0];
    fillOptions(file.select, current.files.map((entry) => ({ value: entry, label: entry })), target);
    memory.projectId = current.id;
    if (target === undefined) {
      source = undefined;
      offset = null;
      showStatus(`${current.title} has no ${current.format === "typst" ? ".typ" : ".tex"} file`, true);
      refresh();
      return;
    }
    memory.path = target;
    void readFile(target);
  };

  const finish = (reply: CiteReply, done: (reply: CiteReply) => string | null): void => {
    busy = false;
    if (closed) { return; }
    const message = done(reply);
    if (message !== null) {
      notify(message);
      closeDialog();
      return;
    }
    if (reply.kind === "error") { showStatus(reply.message, true); }
    refresh();
  };

  const doInsert = (): void => {
    if (insert.disabled || !current || !source || offset === null) { return; }
    const target = source;
    busy = true;
    refresh();
    void client.request({
      kind: "insert", projectId: current.id, path: target.path, version: target.version, offset,
      ...(page === undefined ? {} : { page }),
      ...(quote === undefined ? {} : { quote }),
      quoted: quote !== undefined && quoteBox.checked,
    }).then((reply) => finish(reply, (answer) => {
      if (answer.kind === "inserted") {
        return cite ? `Cited in ${answer.path}` : [`Inserted into ${answer.path}`, answer.hint].filter(Boolean).join(". ");
      }
      if (answer.kind === "error" && answer.stale) {
        // The file changed since it was read: show its new text and ask for the place again.
        void readFile(target.path).then(() => { if (!closed && source) { showStatus(answer.message, true); } });
      }
      return null;
    }));
  };

  const doOnlyAdd = (): void => {
    if (!current || busy) { return; }
    busy = true;
    refresh();
    void client.request({ kind: "bibliography", projectId: current.id })
      .then((reply) => finish(reply, (answer) => (answer.kind === "listed" ? `Added to ${answer.bibliography}` : null)));
  };

  const doCopy = (): void => {
    if (busy) { return; }
    if (code) {
      if (source?.listing === undefined) { return; }
      code.copy(source.listing);
      closeDialog();
      return;
    }
    cite?.post(quote !== undefined && page !== undefined
      ? { command: "copyWithCitation", text: quote, pageNumber: page }
      : { command: "copyCitation", ...(page === undefined ? {} : { pageNumber: page }) });
    closeDialog();
  };

  // Without a project only Copy and Cancel remain.
  const showNoProject = (): void => {
    pickers.hidden = true;
    body.hidden = true;
    quoteField.hidden = true;
    onlyAdd.hidden = true;
    insert.hidden = true;
    // Without a project there is no listing to copy.
    copy.hidden = code !== undefined;
    showStatus(noProject);
  };

  project.select.addEventListener("change", () => selectProject(project.select.value));
  file.select.addEventListener("change", () => {
    memory.path = file.select.value;
    void readFile(file.select.value);
  });
  quoteBox.addEventListener("change", refresh);
  insert.addEventListener("click", doInsert);
  onlyAdd.addEventListener("click", doOnlyAdd);
  copy.addEventListener("click", doCopy);
  content.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      doInsert();
    }
  });

  function closeDialog(): void {
    if (closed) { return; }
    closed = true;
    dialog.close();
    view?.destroy();
    options.onClose?.();
  }
  cancel.addEventListener("click", closeDialog);

  showStatus("Loading projects…");
  refresh();
  void client.request({ kind: "targets" }).then((reply) => {
    if (closed) { return; }
    // A host without a cite port answers with an error; Copy still works there.
    if (reply.kind !== "targets" || reply.projects.length === 0) {
      showNoProject();
      return;
    }
    projects = reply.projects;
    const remembered = projects.find((entry) => entry.id === memory.projectId) ?? projects[0]!;
    fillOptions(project.select, projects.map((entry) => ({ value: entry.id, label: entry.title })), remembered.id);
    selectProject(remembered.id, remembered.id === memory.projectId ? memory.path : undefined);
    void sourceView.then((shown) => shown?.focus());
  });

  return { close: closeDialog };
}
