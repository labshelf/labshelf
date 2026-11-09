// The reader's cite popup (plan reader-cite-popup D3): pick a project and one of its source files, click where the
// citation goes in the read-only source, see it there and Insert; the host writes it. Without a passage it can only add
// the paper to the project's bibliography.
import { mountOverlay, renderElement, showToast } from "../../ui/dom/index.js";
import { createReaderCitation, type CiteProject, type CiteReply } from "../../writing/citations/index.js";
import type { ProjectFormat } from "../../writing/project/index.js";
import { MAX_CITE_QUOTE_LENGTH } from "../protocol/index.js";
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

export interface CiteDialogOptions {
  client: CiteClient;
  citeKey: string;
  page?: number | undefined;
  quote?: string | undefined;
  memory: CiteChoiceMemory;
  /** Loads the source view; the default imports citeSourceView.ts as a lazy chunk. */
  loadSourceView?: () => Promise<CreateCiteSourceView>;
  /** Shows the success notice; the default is a toast. */
  notify?: (message: string) => void;
}

const HINT = "Click in the text where the citation goes";

const loadDefaultSourceView = async (): Promise<CreateCiteSourceView> => (await import("./citeSourceView.js")).createCiteSourceView;

function textButton(label: string, extra = ""): HTMLButtonElement {
  return renderElement("button", { type: "button", class: `rd-btn-text ${extra}`.trim() }, label);
}

function labelledSelect(label: string): { field: HTMLElement; select: HTMLSelectElement } {
  const select = renderElement("select", { class: "rd-cite-dialog-select", "aria-label": label });
  return { field: renderElement("label", { class: "rd-cite-dialog-field" }, renderElement("span", { text: label }), select), select };
}

function fillOptions(select: HTMLSelectElement, entries: ReadonlyArray<{ value: string; label: string }>, selected: string | undefined): void {
  select.replaceChildren(...entries.map((entry) => renderElement("option", { value: entry.value }, entry.label)));
  if (selected !== undefined) { select.value = selected; }
}

/**
 * Opens the cite popup over the reader.
 * @returns close, which dismisses the popup without citing
 */
export function openCiteDialog(options: CiteDialogOptions): { close(): void } {
  const { client, citeKey, page, memory } = options;
  const quote = options.quote?.trim() ? options.quote.slice(0, MAX_CITE_QUOTE_LENGTH) : undefined;
  const notify = options.notify ?? ((message: string) => { showToast(message, "ok"); });

  const project = labelledSelect("Project");
  const file = labelledSelect("File");
  const body = renderElement("div", { class: "rd-cite-dialog-source" });
  const status = renderElement("div", { class: "rd-cite-dialog-status", role: "status", "aria-live": "polite" });
  const quoteBox = renderElement("input", { type: "checkbox", checked: true });
  const quoteField = renderElement("label", { class: "rd-cite-dialog-check" }, quoteBox, "With the quotation");
  const onlyAdd = textButton("Only add to the bibliography");
  const cancel = textButton("Cancel");
  const insert = textButton("Insert", "rd-btn-primary");
  const title = renderElement("div", { class: "rd-cite-dialog-title" },
    renderElement("span", { text: `Cite ${citeKey}` }),
    ...(page === undefined ? [] : [renderElement("span", { class: "rd-cite-dialog-page", text: `p. ${page}` })]));
  const footer = renderElement("div", { class: "rd-cite-dialog-actions" },
    ...(quote === undefined ? [onlyAdd] : [quoteField]),
    renderElement("span", { class: "rd-spacer" }), cancel, insert);
  const content = renderElement("div", { class: "ls-dialog rd-cite-dialog", role: "dialog", "aria-modal": "true", "aria-label": `Cite ${citeKey}` },
    title, renderElement("div", { class: "rd-cite-dialog-pickers" }, project.field, file.field), body, status, footer);

  let projects: CiteProject[] = [];
  let current: CiteProject | undefined;
  let source: { path: string; version: string } | undefined;
  let offset: number | null = null;
  let view: CiteSourceView | undefined;
  let busy = false;
  let closed = false;
  // Each read gets a number, so a late reply of a file the user has left is dropped.
  let readSeq = 0;

  const showStatus = (message: string, error = false): void => {
    status.textContent = message;
    status.classList.toggle("rd-cite-dialog-error", error);
  };
  const citation = (): string | null => (current && offset !== null
    ? createReaderCitation(current.format, citeKey, { page, quote }, quote !== undefined && quoteBox.checked)
    : null);
  const refresh = (): void => {
    insert.disabled = busy || !source || offset === null;
    onlyAdd.disabled = busy;
    onlyAdd.hidden = quote !== undefined || !current || current.inBibliography;
    if (current) { onlyAdd.textContent = `Only add to ${current.bibliography}`; }
    project.select.disabled = busy || projects.length === 0;
    file.select.disabled = busy || !current || current.files.length === 0;
    view?.setCitation(citation());
  };

  const sourceView = (options.loadSourceView ?? loadDefaultSourceView)().then((create) => {
    if (closed) { return undefined; }
    view = create((placed) => {
      offset = placed;
      showStatus(HINT);
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
    source = { path, version: reply.version };
    shown?.show(reply.text, format);
    showStatus(HINT);
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
      closeDialog();
      notify(message);
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
      if (answer.kind === "inserted") { return `Cited in ${answer.path}`; }
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

  project.select.addEventListener("change", () => selectProject(project.select.value));
  file.select.addEventListener("change", () => {
    memory.path = file.select.value;
    void readFile(file.select.value);
  });
  quoteBox.addEventListener("change", refresh);
  insert.addEventListener("click", doInsert);
  onlyAdd.addEventListener("click", doOnlyAdd);
  content.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      doInsert();
    }
  });

  const overlay = mountOverlay(content, () => {
    closed = true;
    view?.destroy();
  });
  function closeDialog(): void {
    if (closed) { return; }
    closed = true;
    overlay.close();
    view?.destroy();
  }
  cancel.addEventListener("click", closeDialog);

  showStatus("Loading projects…");
  refresh();
  void client.request({ kind: "targets" }).then((reply) => {
    if (closed) { return; }
    if (reply.kind !== "targets") {
      showStatus(reply.kind === "error" ? reply.message : "Could not list the projects", true);
      return;
    }
    projects = reply.projects;
    if (projects.length === 0) {
      showStatus("No writing project to cite in", true);
      refresh();
      return;
    }
    const remembered = projects.find((entry) => entry.id === memory.projectId) ?? projects[0]!;
    fillOptions(project.select, projects.map((entry) => ({ value: entry.id, label: entry.title })), remembered.id);
    selectProject(remembered.id, remembered.id === memory.projectId ? memory.path : undefined);
    void sourceView.then((shown) => shown?.focus());
  });

  return { close: closeDialog };
}
