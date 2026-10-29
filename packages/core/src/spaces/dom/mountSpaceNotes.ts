// Mounts the Notes tab of a Space: the list of its note files and the editors of the open note's items.
import { askInputBox, renderElement, renderEmptyNotice } from "../../ui/dom/index.js";
import { mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/qmdEditor.js";
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
export function syncQmdReadOnly(ctx: OverviewContext, data: OverviewContext["data"], controller: AbortController): AbortController | undefined {
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

export function mountSpaceNotes(root: HTMLElement, context: OverviewContext & { notes?: SpaceNoteEntry[] }): SpaceBody {
  let controller = new AbortController();
  const ctx: OverviewContext = { data: context.data, end: context.end, readOnly: context.readOnly, signal: controller.signal };
  let notes = context.notes;
  let selected: string | undefined;
  let items: SpaceQmdItem[] | undefined;
  let known: Set<string> | undefined;
  let editors: ItemEditor[] = [];
  const spaceId = (): string => ctx.data.space.id;

  const create = renderElement("button", { type: "button", class: "ls-btn", text: `New ${QMD_VOCABULARY.item}`, disabled: ctx.readOnly });
  const column = renderElement("section", { class: "nt-list", "aria-label": "Notes" });
  const detail = renderElement("section", { class: "nt-detail", "aria-label": "Note" });
  root.replaceChildren(renderElement("div", { class: "nt-notes" },
    renderElement("header", { class: "nt-head" }, renderElement("p", { text: "Keep ideas, meeting notes and comparisons with this Space." }), create),
    renderElement("div", { class: "nt-layout" }, column, detail)));

  const destroyEditors = (): void => { for (const editor of editors) editor.handle.destroy(); editors = []; };
  const canWrite = (): boolean => !ctx.readOnly && !ctx.signal?.aborted;
  const hasFocus = (): boolean => editors.some(editor => editor.host.contains(document.activeElement));

  const addEditor = (item: SpaceQmdItem | undefined): ItemEditor => {
    const host = renderElement("div", { class: "nt-item" });
    const editor: ItemEditor = { id: item?.id, body: item?.body ?? "", added: false, host, handle: undefined as unknown as QmdEditorHandle };
    editor.handle = mountQmdEditor(host, {
      body: editor.body, readOnly: ctx.readOnly, ...(item ? { meta: qmdItemMeta(item) } : {}),
      onChange: body => {
        editor.body = body;
        if (!canWrite() || selected === undefined) return;
        if (editor.id !== undefined) ctx.end.post({ type: "editSpaceItem", spaceId: spaceId(), path: selected, id: editor.id, body });
        else if (!editor.added && body.trim()) { editor.added = true; ctx.end.post({ type: "addSpaceItem", spaceId: spaceId(), path: selected, body }); }
      },
    });
    return editor;
  };

  const renderDetail = (): void => {
    destroyEditors();
    if (selected === undefined) { detail.replaceChildren(renderEmptyNotice({ text: "No note open.", hint: "Choose a note in the list." })); return; }
    if (!items) { detail.replaceChildren(renderEmptyNotice({ text: "Loading note…" })); return; }
    editors = (items.length ? items : [undefined]).map(addEditor);
    detail.replaceChildren(...editors.map(editor => editor.host));
  };

  const applyItems = (next: SpaceQmdItem[]): void => {
    const first = editors[0];
    if (items && first && first.id === undefined && first.added && next.length) {
      // The placeholder's first item came back with its id; edits typed since go to that item.
      first.id = next[0]!.id;
      if (next.length === 1) {
        items = next;
        if (first.body !== next[0]!.body && canWrite() && selected !== undefined) {
          ctx.end.post({ type: "editSpaceItem", spaceId: spaceId(), path: selected, id: first.id, body: first.body });
        }
        return;
      }
    }
    const same = items !== undefined && editors.length === next.length && editors.every((editor, at) => editor.id === next[at]!.id);
    if (same) {
      next.forEach((item, at) => {
        const editor = editors[at]!;
        if (editor.body === item.body || editor.host.contains(document.activeElement)) return;
        editor.body = item.body; editor.handle.setBody(item.body);
      });
      items = next;
      return;
    }
    if (hasFocus()) return;
    items = next; renderDetail();
  };

  const paintList = (): void => {
    if (!notes) { column.replaceChildren(renderEmptyNotice({ text: "Loading notes…" })); return; }
    if (!notes.length) { column.replaceChildren(renderEmptyNotice({ text: "No notes yet.", hint: "New note keeps ideas and meeting notes with this Space.", inline: true })); return; }
    paintQmdRows(column, "Notes", notes.map(note => ({ path: note.path, title: note.title, meta: note.updated })), selected, open);
  };

  const open = (path: string): void => {
    selected = path; items = undefined; paintList(); renderDetail();
    ctx.end.post({ type: "readSpaceQmd", spaceId: spaceId(), path });
  };

  const setNotes = (next: SpaceNoteEntry[]): void => {
    notes = next;
    if (selected !== undefined && !next.some(note => note.path === selected)) { selected = undefined; items = undefined; renderDetail(); }
    paintList();
    if (known) {
      const added = next.find(note => !known!.has(note.path));
      if (added) { known = undefined; open(added.path); }
    }
  };

  bindQmdCreate(create, ctx, "New note", canWrite, title => {
    known = new Set((notes ?? []).map(note => note.path));
    ctx.end.post({ type: "createSpaceNote", spaceId: spaceId(), title });
  });

  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type === "spaceNotes" && message.spaceId === spaceId()) setNotes(message.notes);
    else if (message.type === "spaceQmd" && message.spaceId === spaceId() && message.path === selected) applyItems(message.items);
  });
  paintList(); renderDetail();

  return {
    update(data) {
      const next = syncQmdReadOnly(ctx, data, controller);
      if (!next) return;
      controller = next; create.disabled = ctx.readOnly;
      renderDetail();
    },
    dispose() { unsubscribe(); controller.abort(); destroyEditors(); root.replaceChildren(); },
  };
}
