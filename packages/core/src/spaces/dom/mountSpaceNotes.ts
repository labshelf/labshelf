// Mounts the Notes tab of a Space: the list of its note files and the editors of the open note's items.
import { askInputBox, renderElement, renderEmptyNotice } from "../../ui/dom/index.js";
import { mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/index.js";
import type { SpaceNoteEntry, SpaceQmdItem } from "../spaceNotesStore.js";
import type { OverviewContext, SpaceBody } from "./mountOverview.js";

export interface QmdRow { path: string; title: string; meta: string }

/** Fills `column` with the rows as buttons; the selected row has `aria-current`, and a focused row keeps focus across the repaint. */
export function paintQmdRows(column: HTMLElement, label: string, rows: readonly QmdRow[], selected: string | undefined, open: (path: string) => void): void {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && column.contains(active) ? active.dataset["path"] : undefined;
  const list = renderElement("ul", { class: "nt-rows", "aria-label": label });
  for (const row of rows) {
    const button = renderElement("button", { type: "button", class: "nt-row", "data-path": row.path, "aria-current": row.path === selected ? "true" : undefined },
      renderElement("span", { class: "nt-row-title", text: row.title }), renderElement("span", { class: "nt-row-meta", text: row.meta }));
    button.addEventListener("click", () => open(row.path));
    list.append(renderElement("li", {}, button));
  }
  list.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>(".nt-row")];
    const at = buttons.findIndex(button => button === document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  });
  column.replaceChildren(list);
  if (focused !== undefined) list.querySelector<HTMLElement>(`.nt-row[data-path="${CSS.escape(focused)}"]`)?.focus();
}

/** The `meta` option of an editor for an item, with only the fields it has. */
export function qmdItemMeta(item: SpaceQmdItem): { author?: string; date?: string } {
  return { ...(item.author === undefined ? {} : { author: item.author }), ...(item.created === undefined ? {} : { date: item.created }) };
}

/** Asks for a title; undefined when cancelled, blank or the view can no longer write. */
async function askQmdTitle(ctx: OverviewContext, title: string, canWrite: () => boolean): Promise<string | undefined> {
  const value = await askInputBox({ title, validate: text => text.trim() ? undefined : "Enter a title.", ...(ctx.signal ? { signal: ctx.signal } : {}) });
  return value?.trim() && canWrite() ? value.trim() : undefined;
}

/** Makes `button` ask for a title and pass it to `create`. */
export function bindQmdCreate(button: HTMLElement, ctx: OverviewContext, title: string, canWrite: () => boolean, create: (title: string) => void): void {
  button.addEventListener("click", () => { void askQmdTitle(ctx, title, canWrite).then(value => { if (value) create(value); }); });
}

/** Applies a new snapshot to `ctx`; returns the controller to keep when the read-only state changed, undefined otherwise. */
function syncQmdReadOnly(ctx: OverviewContext, data: OverviewContext["data"], controller: AbortController): AbortController | undefined {
  const readOnly = !!data.readOnlyReason;
  ctx.data = data;
  if (readOnly === ctx.readOnly) return undefined;
  ctx.readOnly = readOnly;
  if (!readOnly) return controller;
  controller.abort();
  const next = new AbortController();
  ctx.signal = next.signal;
  return next;
}

/** Applies a new snapshot to a mounted space; runs `repaint` only when the read-only state changed. */
export function updateQmdSpace(s: { ctx: OverviewContext; controller: AbortController; create: HTMLButtonElement }, data: OverviewContext["data"], repaint: () => void): void {
  const next = syncQmdReadOnly(s.ctx, data, s.controller);
  if (!next) return;
  s.controller = next; s.create.disabled = s.ctx.readOnly;
  repaint();
}

interface ItemEditor {
  /** Undefined for the placeholder editor of a file with no item yet. */
  id: string | undefined;
  /** The last body the editor was given or reported. */
  body: string;
  /** Set once the first body of the placeholder was posted as a new item. */
  added: boolean;
  host: HTMLElement;
  handle: QmdEditorHandle;
}

interface NotesState {
  controller: AbortController;
  ctx: OverviewContext;
  notes: SpaceNoteEntry[] | undefined;
  selected: string | undefined;
  items: SpaceQmdItem[] | undefined;
  known: Set<string> | undefined;
  editors: ItemEditor[];
  create: HTMLButtonElement;
  column: HTMLElement;
  detail: HTMLElement;
}

const notesSpaceId = (s: NotesState): string => s.ctx.data.space.id;
const canWriteNotes = (s: NotesState): boolean => !s.ctx.readOnly && !s.ctx.signal?.aborted;

function buildNotesState(root: HTMLElement, context: OverviewContext & { notes?: SpaceNoteEntry[] }): NotesState {
  const controller = new AbortController();
  const ctx: OverviewContext = { data: context.data, end: context.end, readOnly: context.readOnly, signal: controller.signal };
  const create = renderElement("button", { type: "button", class: "ls-btn", text: `New ${QMD_VOCABULARY.item}`, disabled: ctx.readOnly });
  const column = renderElement("section", { class: "nt-list", "aria-label": "Notes" });
  const detail = renderElement("section", { class: "nt-detail", "aria-label": "Note" });
  root.replaceChildren(renderElement("div", { class: "nt-notes" },
    renderElement("header", { class: "nt-head" }, renderElement("p", { text: "Keep ideas, meeting notes and comparisons with this Space." }), create),
    renderElement("div", { class: "nt-layout" }, column, detail)));
  return { controller, ctx, notes: context.notes, selected: undefined, items: undefined, known: undefined, editors: [], create, column, detail };
}

function destroyNoteEditors(s: NotesState): void {
  for (const editor of s.editors) editor.handle.destroy();
  s.editors = [];
}

function addNoteEditor(s: NotesState, item: SpaceQmdItem | undefined): ItemEditor {
  const host = renderElement("div", { class: "nt-item" });
  const editor: ItemEditor = { id: item?.id, body: item?.body ?? "", added: false, host, handle: undefined as unknown as QmdEditorHandle };
  editor.handle = mountQmdEditor(host, {
    body: editor.body, readOnly: s.ctx.readOnly, ...(item ? { meta: qmdItemMeta(item) } : {}),
    onChange: body => {
      editor.body = body;
      const path = s.selected;
      if (!canWriteNotes(s) || path === undefined) return;
      if (editor.id !== undefined) s.ctx.end.post({ type: "editSpaceItem", spaceId: notesSpaceId(s), path, id: editor.id, body });
      else if (!editor.added && body.trim()) { editor.added = true; s.ctx.end.post({ type: "addSpaceItem", spaceId: notesSpaceId(s), path, body }); }
    },
  });
  return editor;
}

function renderNoteDetail(s: NotesState): void {
  destroyNoteEditors(s);
  if (s.selected === undefined) { s.detail.replaceChildren(renderEmptyNotice({ text: "No note open.", hint: "Choose a note in the list." })); return; }
  if (!s.items) { s.detail.replaceChildren(renderEmptyNotice({ text: "Loading note…" })); return; }
  s.editors = (s.items.length ? s.items : [undefined]).map(item => addNoteEditor(s, item));
  s.detail.replaceChildren(...s.editors.map(editor => editor.host));
}

/** True when the placeholder's first item came back and the new items were fully handled. */
function adoptPlaceholderItem(s: NotesState, next: SpaceQmdItem[]): boolean {
  const first = s.editors[0];
  if (!(s.items && first && first.id === undefined && first.added && next.length)) return false;
  // The placeholder's first item came back with its id; edits typed since go to that item.
  first.id = next[0]!.id;
  if (next.length !== 1) return false;
  s.items = next;
  if (first.body !== next[0]!.body && canWriteNotes(s) && s.selected !== undefined) {
    s.ctx.end.post({ type: "editSpaceItem", spaceId: notesSpaceId(s), path: s.selected, id: first.id, body: first.body });
  }
  return true;
}

function applyNoteItems(s: NotesState, next: SpaceQmdItem[]): void {
  if (adoptPlaceholderItem(s, next)) return;
  const same = s.items !== undefined && s.editors.length === next.length && s.editors.every((editor, at) => editor.id === next[at]!.id);
  if (same) {
    next.forEach((item, at) => {
      const editor = s.editors[at]!;
      if (editor.body === item.body || editor.host.contains(document.activeElement)) return;
      editor.body = item.body; editor.handle.setBody(item.body);
    });
    s.items = next;
    return;
  }
  if (s.editors.some(editor => editor.host.contains(document.activeElement))) return;
  s.items = next; renderNoteDetail(s);
}

function paintNotesList(s: NotesState): void {
  const { notes, column } = s;
  if (!notes) { column.replaceChildren(renderEmptyNotice({ text: "Loading notes…" })); return; }
  if (!notes.length) { column.replaceChildren(renderEmptyNotice({ text: "No notes yet.", hint: "New note keeps ideas and meeting notes with this Space.", inline: true })); return; }
  paintQmdRows(column, "Notes", notes.map(note => ({ path: note.path, title: note.title, meta: note.updated })), s.selected, path => openNote(s, path));
}

function openNote(s: NotesState, path: string): void {
  s.selected = path; s.items = undefined; paintNotesList(s); renderNoteDetail(s);
  s.ctx.end.post({ type: "readSpaceQmd", spaceId: notesSpaceId(s), path });
}

function setNotes(s: NotesState, next: SpaceNoteEntry[]): void {
  s.notes = next;
  if (s.selected !== undefined && !next.some(note => note.path === s.selected)) { s.selected = undefined; s.items = undefined; renderNoteDetail(s); }
  paintNotesList(s);
  const known = s.known;
  if (known) {
    const added = next.find(note => !known.has(note.path));
    if (added) { s.known = undefined; openNote(s, added.path); }
  }
}

export function mountSpaceNotes(root: HTMLElement, context: OverviewContext & { notes?: SpaceNoteEntry[] }): SpaceBody {
  const s = buildNotesState(root, context);
  bindQmdCreate(s.create, s.ctx, "New note", () => canWriteNotes(s), title => {
    s.known = new Set((s.notes ?? []).map(note => note.path));
    s.ctx.end.post({ type: "createSpaceNote", spaceId: notesSpaceId(s), title });
  });
  const unsubscribe = s.ctx.end.subscribe(message => {
    if (message.type === "spaceNotes" && message.spaceId === notesSpaceId(s)) setNotes(s, message.notes);
    else if (message.type === "spaceQmd" && message.spaceId === notesSpaceId(s) && message.path === s.selected) applyNoteItems(s, message.items);
  });
  paintNotesList(s); renderNoteDetail(s);

  return {
    update(data) { updateQmdSpace(s, data, () => renderNoteDetail(s)); },
    dispose() { unsubscribe(); s.controller.abort(); destroyNoteEditors(s); root.replaceChildren(); },
  };
}
