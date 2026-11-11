// The "From paper…" picker of the note editor: find a library paper (or start on the note's own), list its numbered equations, figures and tables with
// lazy previews, and insert the chosen one after the caret as real blocks, its image files written through the note's files port first.
import type { EditorView } from "prosemirror-view";
import { formatError } from "../../errors/index.js";
import { renderElement, showToast } from "../../ui/dom/index.js";
import { renderPickerDialog, type PickerDialog } from "../../ui/dom/widgets/pickerDialog.js";
import type { PaperChoice, PaperObject, PaperObjectKind, PaperObjectsPort } from "../../paperObjects/types.js";
import { docToBody } from "../editor/index.js";
import { newItemId } from "../item/index.js";
import type { NoteFilesPort } from "../noteFiles.js";
import { insertBlocksAfterCaret, markdownBlocks } from "./insertBlock.js";

/** What a host gives a note editor to offer From paper…: the port, and the paper the note belongs to, which the picker opens on. */
export interface NotePaperObjects { port: PaperObjectsPort; defaultPaperId?: string }

/** The editor's form of the option: `otherBodies` are the bodies of the note file's other items, whose equation labels a new one avoids. */
export interface EditorPaperObjects extends NotePaperObjects { otherBodies?: () => readonly string[] }

export interface PaperObjectPickerOptions extends EditorPaperObjects { files?: NoteFilesPort }

const SEARCH_DELAY_MS = 150;
const SECTIONS: ReadonlyArray<{ kind: PaperObjectKind; title: string; words: string }> = [
  { kind: "equation", title: "Equations", words: "equation eq" },
  { kind: "figure", title: "Figures", words: "figure fig" },
  { kind: "table", title: "Tables", words: "table tab" },
];
const EMPTY_PDF = "No numbered equations, figures or tables found in this PDF.";
const IMAGE_NOTICE = "Read from the image — check it against the paper";

/** The equation labels `{#eq-…}` used in `bodies`, without the `eq-` prefix, each once. */
export function equationLabelsIn(bodies: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const body of bodies) for (const match of body.matchAll(/\{#eq-([^\s}]+)/g)) labels.add(match[1]!);
  return [...labels];
}

/** "Eq. (3)", "Figure 2", "Table 1". */
function paperObjectName(object: Pick<PaperObject, "kind" | "label">): string {
  return object.kind === "equation" ? `Eq. (${object.label})` : `${object.kind === "figure" ? "Figure" : "Table"} ${object.label}`;
}

/** Whether every word of `query` starts a word of the entry's kind, name or caption ("3", "fig 2", "tab"). */
export function matchesPaperObject(object: PaperObject, query: string): boolean {
  const split = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(Boolean);
  const words = split(`${SECTIONS.find((section) => section.kind === object.kind)!.words} ${object.label} ${object.caption}`);
  return split(query).every((token) => words.some((word) => word.startsWith(token)));
}

/** One row of the listbox: a paper in search mode, an object in the paper's list. */
interface Row { el: HTMLElement; paper?: PaperChoice; object?: PaperObject }

interface Picker {
  view: EditorView;
  options: PaperObjectPickerOptions;
  dialog: PickerDialog;
  paperRow: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  asImage: HTMLInputElement;
  insert: HTMLButtonElement;
  mode: "search" | "list";
  paper: { id: string; choice?: PaperChoice } | undefined;
  objects: PaperObject[];
  rows: Row[];
  active: number;
  busy: boolean;
  /** Bumped by each search or list load, so a late answer to an older one is dropped. */
  seq: number;
  searchTimer: ReturnType<typeof setTimeout> | undefined;
  previews: Map<string, string | null>;
  observer: IntersectionObserver | undefined;
  closed: boolean;
}

let pickerCount = 0;
const objectKey = (object: PaperObject): string => `${object.kind}:${object.label}:${object.page}`;
const paperDetail = (paper: PaperChoice): string => [paper.authors, paper.year].filter(Boolean).join(" · ");

function setActive(p: Picker, index: number): void {
  p.active = p.rows.length === 0 ? -1 : Math.max(0, Math.min(p.rows.length - 1, index));
  p.rows.forEach((row, n) => { row.el.classList.toggle("is-active", n === p.active); row.el.setAttribute("aria-selected", String(n === p.active)); });
  const row = p.rows[p.active];
  if (row) { p.input.setAttribute("aria-activedescendant", row.el.id); row.el.scrollIntoView?.({ block: "nearest" }); if (row.object) void loadPreview(p, row); }
  else p.input.removeAttribute("aria-activedescendant");
  p.insert.disabled = p.busy || !row;
}

function showMessage(p: Picker, text: string): void {
  p.rows = [];
  p.list.replaceChildren(renderElement("p", { class: "qmd-paper-pick-empty ls-empty-text", text }));
  setActive(p, -1);
}

function renderRow(p: Picker, index: number, content: HTMLElement[]): HTMLElement {
  const el = renderElement("div", { class: "qmd-paper-pick-row", role: "option", id: `qmd-paper-pick-${pickerCount}-${index}`, "aria-selected": "false" }, ...content);
  el.addEventListener("mousedown", (event) => event.preventDefault());
  el.addEventListener("mousemove", () => { if (p.active !== index) setActive(p, index); });
  el.addEventListener("click", () => { setActive(p, index); choose(p, false); });
  return el;
}

// ---------------------------------------------------------------------------------------------------------------- search mode

function showPapers(p: Picker, papers: readonly PaperChoice[]): void {
  if (papers.length === 0) { showMessage(p, p.input.value.trim() ? "No paper in the library matches." : "No papers in the library yet."); return; }
  p.rows = papers.map((paper, index) => {
    const meta = renderElement("span", { class: "qmd-paper-pick-meta", text: paperDetail(paper) });
    const key = renderElement("span", { class: "qmd-paper-pick-key", text: paper.citeKey ?? "" });
    const el = renderRow(p, index, [renderElement("span", { class: "qmd-paper-pick-title", text: paper.title || "Untitled paper" }), renderElement("span", { class: "qmd-paper-pick-line" }, meta, key)]);
    return { el, paper };
  });
  p.list.replaceChildren(...p.rows.map((row) => row.el));
  setActive(p, 0);
}

function searchPapers(p: Picker): void {
  const seq = ++p.seq;
  showMessage(p, "Searching the library…");
  p.options.port.papers(p.input.value.trim()).then(
    (papers) => { if (seq === p.seq && !p.closed) showPapers(p, papers); },
    (error: unknown) => { if (seq === p.seq && !p.closed) showMessage(p, `The library could not be searched — ${formatError(error)}`); },
  );
}

function enterSearch(p: Picker): void {
  p.mode = "search";
  p.paperRow.hidden = true;
  p.asImage.closest("label")!.hidden = true;
  p.insert.textContent = "Open";
  p.input.value = "";
  p.input.placeholder = "Search by title, author or cite key";
  p.input.setAttribute("aria-label", "Search papers");
  p.dialog.showStatus("");
  searchPapers(p);
  p.input.focus();
}

// ---------------------------------------------------------------------------------------------------------------- list mode

function renderObjectRow(p: Picker, object: PaperObject, index: number): Row {
  const preview = renderElement("span", { class: "qmd-paper-pick-preview", "aria-hidden": "true" });
  const text = renderElement("span", { class: "qmd-paper-pick-text" },
    renderElement("span", { class: "qmd-paper-pick-title", text: paperObjectName(object) }),
    renderElement("span", { class: "qmd-paper-pick-caption", text: object.caption, title: object.caption }));
  const page = renderElement("span", { class: "qmd-paper-pick-page", text: `p. ${object.page}` });
  const image = renderElement("button", { class: "ls-btn ls-btn-ghost qmd-paper-pick-image", type: "button", tabindex: "-1", text: "As image", title: `Insert ${paperObjectName(object)} as an image` });
  image.addEventListener("mousedown", (event) => event.preventDefault());
  image.addEventListener("click", (event) => { event.stopPropagation(); setActive(p, index); choose(p, true); });
  const row: Row = { el: renderRow(p, index, [preview, text, page, image]), object };
  p.observer?.observe(row.el);
  return row;
}

function showObjects(p: Picker): void {
  p.observer?.disconnect();
  if (p.objects.length === 0) { showMessage(p, EMPTY_PDF); return; }
  const query = p.input.value.trim();
  const shown = p.objects.filter((object) => matchesPaperObject(object, query));
  if (shown.length === 0) { showMessage(p, `Nothing matches “${query}”.`); return; }
  p.rows = [];
  const groups: HTMLElement[] = [];
  for (const section of SECTIONS) {
    const objects = shown.filter((object) => object.kind === section.kind);
    if (objects.length === 0) continue;
    const id = `qmd-paper-pick-${pickerCount}-${section.kind}`;
    const rows = objects.map((object, n) => renderObjectRow(p, object, p.rows.length + n));
    p.rows.push(...rows);
    groups.push(renderElement("div", { class: "qmd-paper-pick-group", role: "group", "aria-labelledby": id },
      renderElement("h3", { class: "qmd-paper-pick-heading", id, text: section.title }), ...rows.map((row) => row.el)));
  }
  p.list.replaceChildren(...groups);
  setActive(p, 0);
}

function openPaper(p: Picker, paper: { id: string; choice?: PaperChoice }): void {
  p.mode = "list";
  p.paper = paper;
  p.objects = [];
  const { choice } = paper;
  p.paperRow.querySelector(".qmd-paper-pick-paper-title")!.textContent = choice ? choice.title || "Untitled paper" : "This note's paper";
  p.paperRow.querySelector(".qmd-paper-pick-paper-meta")!.textContent = choice ? paperDetail(choice) : "";
  p.paperRow.hidden = false;
  p.asImage.closest("label")!.hidden = false;
  p.insert.textContent = "Insert";
  p.input.value = "";
  p.input.placeholder = "Filter: 3, fig 2, tab";
  p.input.setAttribute("aria-label", "Filter equations, figures and tables");
  p.dialog.showStatus("");
  const seq = ++p.seq;
  showMessage(p, "Reading the paper…");
  p.options.port.list(paper.id).then(
    (objects) => { if (seq !== p.seq || p.closed) return; p.objects = objects; showObjects(p); },
    (error: unknown) => { if (seq === p.seq && !p.closed) showMessage(p, formatError(error)); },
  );
  p.input.focus();
}

/** Shows the object's preview once: a PNG through a blob: URL, revoked when the picker closes; no preview when it fails or cannot be shown. */
async function loadPreview(p: Picker, row: Row): Promise<void> {
  const { object } = row;
  if (!object || !p.paper || typeof URL.createObjectURL !== "function") return;
  const key = objectKey(object);
  if (p.previews.has(key)) return;
  p.previews.set(key, null);
  let bytes: Uint8Array | null = null;
  try { bytes = await p.options.port.preview(p.paper.id, object); } catch { return; }
  if (!bytes || p.closed) return;
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
  p.previews.set(key, url);
  row.el.querySelector(".qmd-paper-pick-preview")?.replaceChildren(renderElement("img", { src: url, alt: "" }));
}

// ---------------------------------------------------------------------------------------------------------------- choosing

function choose(p: Picker, image: boolean): void {
  const row = p.rows[p.active];
  if (!row || p.busy) return;
  if (row.paper) openPaper(p, { id: row.paper.id, choice: row.paper });
  else if (row.object) void insertObject(p, row, image || p.asImage.checked);
}

function setBusy(p: Picker, row: Row | undefined, busy: boolean): void {
  p.busy = busy;
  p.insert.disabled = busy || p.rows[p.active] === undefined;
  if (!row) return;
  row.el.classList.toggle("is-busy", busy);
  row.el.setAttribute("aria-busy", String(busy));
  if (busy) row.el.append(renderElement("span", { class: "qmd-paper-pick-busy", text: "Reading…" }));
  else row.el.querySelector(".qmd-paper-pick-busy")?.remove();
}

/** Builds the object's Markdown, writes its files, inserts its blocks after the caret and closes; a failure stays in the picker's status line. */
async function insertObject(p: Picker, row: Row, asImage: boolean): Promise<void> {
  const { view, options } = p;
  const object = row.object!;
  setBusy(p, row, true);
  p.dialog.showStatus("");
  try {
    const takenLabels = equationLabelsIn([docToBody(view.state.doc), ...(options.otherBodies?.() ?? [])]);
    const result = await options.port.insert(p.paper!.id, object, { assetName: newItemId(), takenLabels, ...(asImage ? { asImage: true } : {}) });
    if (p.closed) return;
    if (result.assets.length > 0 && !options.files) { p.dialog.showStatus("This editor cannot save images", true); return; }
    for (const asset of result.assets) await options.files!.write(asset.path, asset.bytes);
    if (p.closed || view.isDestroyed) return;
    if (!insertBlocksAfterCaret(markdownBlocks(result.markdown))(view.state, view.dispatch.bind(view))) {
      p.dialog.showStatus(`${paperObjectName(object)} cannot go here: put the caret in a paragraph and try again.`, true);
      return;
    }
    close(p);
    view.focus();
    if (result.via === "pix2tex" || result.via === "ai") showToast(IMAGE_NOTICE, "info");
    else if (result.via === "image" && object.kind !== "figure") showToast("Inserted as an image: no text could be read", "info");
  } catch (error) {
    if (!p.closed) p.dialog.showStatus(`${paperObjectName(object)} could not be inserted — ${formatError(error)}`, true);
  } finally {
    if (!p.closed) setBusy(p, row, false);
  }
}

function close(p: Picker): void {
  if (p.closed) return;
  cleanUp(p);
  p.dialog.close();
}

function cleanUp(p: Picker): void {
  p.closed = true;
  clearTimeout(p.searchTimer);
  p.observer?.disconnect();
  for (const url of p.previews.values()) if (url) URL.revokeObjectURL(url);
  p.previews.clear();
}

function onKeydown(p: Picker, event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setActive(p, p.active + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    choose(p, event.altKey);
  }
}

function onInput(p: Picker): void {
  if (p.mode === "list") { showObjects(p); return; }
  clearTimeout(p.searchTimer);
  p.searchTimer = setTimeout(() => searchPapers(p), SEARCH_DELAY_MS);
}

/** Opens the picker over the editor; the chosen object goes in after the caret's block (the selected block's, at an insert gap). */
export function openPaperObjectPicker(view: EditorView, options: PaperObjectPickerOptions): void {
  pickerCount += 1;
  const listId = `qmd-paper-pick-${pickerCount}-list`;
  const input = renderElement("input", { class: "ls-input qmd-paper-pick-input", type: "text", spellcheck: "false", autocomplete: "off", role: "combobox", "aria-expanded": "true", "aria-controls": listId, "aria-autocomplete": "list" });
  const list = renderElement("div", { class: "qmd-paper-pick-list", id: listId, role: "listbox", "aria-label": "From paper" });
  const change = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", text: "Change paper" });
  const paperRow = renderElement("div", { class: "qmd-paper-pick-paper" },
    renderElement("span", { class: "qmd-paper-pick-paper-title" }), renderElement("span", { class: "qmd-paper-pick-paper-meta" }), change);
  const asImage = renderElement("input", { type: "checkbox" });
  const imageField = renderElement("label", { class: "rd-cite-dialog-check" }, asImage, "Insert as image");
  const cancel = renderElement("button", { class: "ls-btn", type: "button", text: "Cancel" });
  const insert = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Insert" });
  const dialog = renderPickerDialog({ heading: "Insert from paper", pickers: [], leading: [imageField], trailing: [cancel, insert], onDismiss: () => cleanUp(p) });
  dialog.content.classList.add("qmd-paper-pick");
  dialog.pickers.hidden = true;
  dialog.body.classList.add("qmd-paper-pick-body");
  dialog.body.append(paperRow, input, list);
  const p: Picker = {
    view, options, dialog, paperRow, input, list, asImage, insert, mode: "search", paper: undefined, objects: [], rows: [], active: -1, busy: false, seq: 0,
    searchTimer: undefined, previews: new Map(), closed: false,
    observer: typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) { const row = p.rows.find((r) => r.el === entry.target); if (row) void loadPreview(p, row); } }, { root: list })
      : undefined,
  };
  input.addEventListener("keydown", (event) => onKeydown(p, event));
  input.addEventListener("input", () => onInput(p));
  change.addEventListener("click", () => enterSearch(p));
  cancel.addEventListener("click", () => close(p));
  insert.addEventListener("click", () => choose(p, false));
  if (options.defaultPaperId !== undefined) openPaper(p, { id: options.defaultPaperId });
  else enterSearch(p);
}
