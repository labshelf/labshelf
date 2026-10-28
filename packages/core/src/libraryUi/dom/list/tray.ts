// The files tray under an open paper: its rows from the paper's record and file listing, the hover buttons and context menu of a row, and the request for the files.
import type { PaperRecord } from "../../../model/index.js";
import { openPaper } from "../flows/index.js";
import type { UiContext } from "../uiContext.js";
import { renderElement, askInputBox, showMenu, type MenuEntry } from "../../../ui/dom/index.js";
import type { PaperFile, PaperNoteView } from "../../protocol/index.js";
import { formatUtcDate } from "../../../time/index.js";
import { escapeHtml, renderIcon, type IconName } from "../../../ui/index.js";

const MAX_LENGTH = 140;
const PDF_NAME = "paper.pdf";

function noteButton(text: string, empty: boolean): HTMLButtonElement {
  const label = empty ? "Edit short note" : `Edit short note: ${text}`;
  return renderElement("button", { class: `file-fact-btn${empty ? " empty" : ""}`, type: "button", "aria-label": label, text });
}

function noteInput(value: string): HTMLInputElement {
  return renderElement("input", { class: "file-fact-input", type: "text", value, maxlength: String(MAX_LENGTH), spellcheck: "false", autocomplete: "off", "aria-label": "Short note" });
}

/** Fills the fact cell of the paper.pdf row with the short note and lets a click turn it into a text field; other rows are left alone. */
function addShortNote(ctx: UiContext, id: string, e: TrayEntry, row: HTMLElement): void {
  const cell = row.querySelector<HTMLElement>(".file-fact");
  if (e.kind !== "pdf" || !e.fact || !cell) return;
  let saved = e.fact.placeholder ? "" : e.fact.text;

  const show = (): HTMLButtonElement => {
    const button = noteButton(saved || SHORT_NOTE_PLACEHOLDER, !saved);
    // The row's own click would open the PDF.
    button.addEventListener("click", (ev) => { ev.stopPropagation(); edit(); });
    cell.replaceChildren(button);
    return button;
  };

  const edit = (): void => {
    const input = noteInput(saved);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      if (commit && text !== saved) {
        saved = text;
        ctx.transport.post({ type: "paper.describeFile", id, name: PDF_NAME, description: text });
      }
      const hadFocus = document.activeElement === input;
      const button = show();
      if (hadFocus) button.focus({ preventScroll: true });
    };
    // Keys typed here belong to the field, not to the list shortcuts or the row.
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    input.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("blur", () => finish(true));
    cell.replaceChildren(input);
    input.focus();
    input.select();
  };

  show();
}

// What each tray was last built from, so an unrelated store change keeps its rows and focus.
const built = new WeakMap<HTMLElement, unknown[]>();

function activate(ctx: UiContext, id: string, e: TrayEntry): void {
  if (e.kind === "pdf") openPaper(ctx, id);
  else if (e.kind === "file") ctx.transport.post({ type: "paper.openFile", id, name: e.name });
  else if (e.kind === "folder") ctx.transport.post({ type: "paper.revealFile", id, name: e.name });
  // The Note row selects its paper; the detail pane then shows the note.
  else ctx.store.selectOnly(id);
}

function trayRows(ctx: UiContext, id: string, record: PaperRecord): HTMLElement[] {
  const state = ctx.store.get().files[id];
  if (!state || state.status === "loading") return [buildLoadingRow()];
  if (state.status === "failed") return [buildFailedRow(state.message)];
  return deriveTrayEntries(record, state.files, ctx.store.get().details[id]?.notes).map((e) => {
    const open = (): void => activate(ctx, id, e);
    const row = buildTrayRow(e, open);
    addRowActions(ctx, id, e, row, open);
    addShortNote(ctx, id, e, row);
    return row;
  });
}

function rowKey(el: Element | null): string | null {
  const r = el?.closest(".file-row");
  const kind = r?.getAttribute("data-kind");
  return kind ? `${kind}:${r?.getAttribute("data-name")}` : null;
}

/** Replaces a tray's rows; focus inside it goes to the row of the same kind and name, or to the paper row when that row is gone. */
export function updateTrayRows(tray: HTMLElement, rows: HTMLElement[]): void {
  const hadFocus = tray.contains(document.activeElement);
  const key = rowKey(document.activeElement);
  tray.replaceChildren(...rows);
  if (!hadFocus) return;
  const target = rows.find((r) => rowKey(r) === key) ?? tray.closest(".paper-row")?.querySelector<HTMLElement>(".paper-row-main");
  target?.focus({ preventScroll: true });
}

/** Paints the tray of the expanded unit and clears the rest; call after the units are rendered and `.expanded` is set. */
export function drawTray(ctx: UiContext, root: HTMLElement, records: ReadonlyMap<string, PaperRecord>): void {
  const { files, details } = ctx.store.get();
  root.querySelectorAll<HTMLElement>(".paper-row").forEach((unit) => {
    const tray = unit.querySelector<HTMLElement>(".paper-children");
    if (!tray) return;
    const id = unit.dataset["id"] ?? "";
    const record = records.get(id);
    if (!unit.classList.contains("expanded") || !record) {
      if (built.delete(tray)) tray.replaceChildren();
      return;
    }
    const inputs = [record, files[id], details[id]?.notes];
    const last = built.get(tray);
    if (last && inputs.every((v, i) => v === last[i])) return;
    built.set(tray, inputs);
    updateTrayRows(tray, trayRows(ctx, id, record));
  });
}

type TrayKind = "pdf" | "note" | "file" | "folder";
type TypeTone = "pdf" | "md" | "dir" | "other";

export interface TrayEntry {
  kind: TrayKind;
  name: string;
  /** Text of the type cell; empty for a folder, which shows a chevron. */
  type: string;
  tone: TypeTone;
  /** The label is empty when the type and name already say what the fact is, as for the Note. `placeholder` marks the hint shown for an empty short note. */
  fact: { label: string; text: string; placeholder?: true } | null;
  title: string;
}



function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function tooltip(f: PaperFile): string {
  const date = formatUtcDate(f.modified);
  const parts = [f.kind === "file" && f.size !== undefined ? formatSize(f.size) : "", date ? `modified ${date}` : ""];
  return parts.filter(Boolean).join(" · ");
}

function typeOf(f: PaperFile): Pick<TrayEntry, "type" | "tone"> {
  if (f.kind === "folder") return { type: "", tone: "dir" };
  const ext = f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext === "pdf") return { type: "PDF", tone: "pdf" };
  if (ext === "md") return { type: "MD", tone: "md" };
  return { type: ext ? ext.toUpperCase() : "FILE", tone: "other" };
}

const SHORT_NOTE_PLACEHOLDER = "Add a short note";

// The paper.pdf row carries the user's short description of the paper, which identifies it in the list.
function pdfFact(f: PaperFile): TrayEntry["fact"] {
  return f.description ? { label: "", text: f.description } : { label: "", text: SHORT_NOTE_PLACEHOLDER, placeholder: true };
}

function fileFact(f: PaperFile): TrayEntry["fact"] {
  return f.description ? { label: f.kind === "folder" ? "Source" : "Contents", text: f.description } : null;
}

function noteEntry(notes: readonly PaperNoteView[]): TrayEntry {
  const first = notes.at(-1)?.body.split("\n").map((l) => l.trim()).find(Boolean);
  return { kind: "note", name: "Note", type: "MD", tone: "md", fact: { label: "", text: first ?? "Empty" }, title: "" };
}

/** The tray rows in display order: paper.pdf, the Note, other files, then subfolders. */
export function deriveTrayEntries(record: PaperRecord, listed: readonly PaperFile[], notes: readonly PaperNoteView[] = []): TrayEntry[] {
  const shown = listed.filter((f) => f.name !== "metadata.yaml");
  const toEntry = (f: PaperFile): TrayEntry => {
    const isPdf = f.kind === "file" && f.name === PDF_NAME;
    return { kind: isPdf ? "pdf" : f.kind, name: f.name, ...typeOf(f), fact: isPdf ? pdfFact(f) : fileFact(f), title: tooltip(f) };
  };
  const pdf = shown.filter((f) => f.kind === "file" && f.name === PDF_NAME).map(toEntry);
  const rest = shown.filter((f) => !(f.kind === "file" && f.name === PDF_NAME)).map(toEntry);
  return [...pdf, noteEntry(notes), ...rest];
}

const cell = (cls: string, html: string): string => `<div class="${cls}" role="gridcell">${html}</div>`;

function row(extra: string, title: string, html: string, attrs: Record<string, string> = {}): HTMLElement {
  return renderElement("div", { class: `file-row${extra}`, role: "row", "aria-level": "2", tabindex: "-1", title, html, ...attrs });
}

/** A row for a note, file or subfolder; `data-kind` and `data-name` say which one it is. */
export function buildTrayRow(e: TrayEntry, onActivate: () => void): HTMLElement {
  const type = e.kind === "folder" ? renderIcon("chevron-right") : escapeHtml(e.type);
  const label = e.fact?.label ? `<span class="file-fact-label">${escapeHtml(e.fact.label)}</span> ` : "";
  // The paper.pdf fact is a button the short-note editor fills in.
  const fact = e.fact && e.kind !== "pdf" ? label + escapeHtml(e.fact.text) : "";
  const r = row("", e.title,
    cell(`file-type tone-${e.tone}`, type) + cell("file-name", escapeHtml(e.name)) + cell("file-fact", fact) + cell("file-actions", ""),
    { "data-kind": e.kind, "data-name": e.name });
  r.addEventListener("click", onActivate);
  return r;
}

/** The single row shown while the listing loads. */
export function buildLoadingRow(): HTMLElement {
  return row(" file-state", "", cell("file-type", `<span class="spin">${renderIcon("loader")}</span>`) + cell("file-message", "Loading files…"));
}

/** The single row shown when the listing could not be read. */
export function buildFailedRow(message: string): HTMLElement {
  return row(" file-state failed", message, cell("file-type", renderIcon("warning")) + cell("file-message", escapeHtml(message)));
}

export function attachFilesRequest(ctx: UiContext): () => void {
  return ctx.store.select((s) => s.open, (id) => { if (id) ctx.transport.post({ type: "paper.files", id }); });
}

type FileMessage = "paper.openFile" | "paper.revealFile" | "paper.copyFilePath";

interface FileAction { label: string; glyph: IconName; message: FileMessage; filesOnly: boolean }

const OPEN_TO_SIDE: FileAction = { label: "Open to the side", glyph: "open-to-side", message: "paper.openFile", filesOnly: true };
const REVEAL: FileAction = { label: "Reveal in folder", glyph: "folder-open", message: "paper.revealFile", filesOnly: false };
const COPY_PATH: FileAction = { label: "Copy path", glyph: "copy", message: "paper.copyFilePath", filesOnly: false };
const ACTIONS = [OPEN_TO_SIDE, REVEAL, COPY_PATH];

const offered = (e: TrayEntry): FileAction[] => ACTIONS.filter((a) => !a.filesOnly || e.kind !== "folder");

// A file listing is the only place a description lives; a missing or loading listing means none yet.
function currentDescription(ctx: UiContext, id: string, name: string): string {
  const state = ctx.store.get().files[id];
  return state?.status === "ready" ? state.files.find((f) => f.name === name)?.description ?? "" : "";
}

async function describe(ctx: UiContext, id: string, name: string): Promise<void> {
  const text = await askInputBox({ title: `Describe ${name}`, value: currentDescription(ctx, id, name), placeholder: "One line about this file" });
  if (text !== undefined) ctx.transport.post({ type: "paper.describeFile", id, name, description: text.trim() });
}

function menuEntries(ctx: UiContext, id: string, e: TrayEntry, activate: () => void): MenuEntry[] {
  const entries: MenuEntry[] = [{ icon: "file", label: "Open", onSelect: activate }];
  for (const a of offered(e)) entries.push({ icon: a.glyph, label: a.label, onSelect: () => ctx.transport.post({ type: a.message, id, name: e.name }) });
  // paper.pdf's description is the short note, edited inline in its row.
  if (e.kind !== "pdf") entries.push("separator", { icon: "edit", label: "Describe…", onSelect: () => { void describe(ctx, id, e.name); } });
  return entries;
}

/** Adds the hover buttons and the context menu to a file or folder row; the Note row keeps the paper's menu. */
function addRowActions(ctx: UiContext, id: string, e: TrayEntry, row: HTMLElement, activate: () => void): void {
  if (e.kind === "note") return;
  const slot = row.querySelector<HTMLElement>(".file-actions");
  for (const a of offered(e)) {
    const button = renderElement("button", { class: "ls-icon-btn", type: "button", tabindex: "-1", "aria-label": a.label, title: a.label, html: renderIcon(a.glyph) });
    button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ctx.transport.post({ type: a.message, id, name: e.name });
    });
    slot?.append(button);
  }
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    showMenu({ x: ev.clientX, y: ev.clientY }, menuEntries(ctx, id, e, activate));
  });
}
