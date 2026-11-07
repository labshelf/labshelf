// Paints the messages of the open conversation of a Space's Discussions tab, keeping each unchanged message mounted, and edits or removes
// the user's own messages in place.
import { askDialog, renderElement, renderEmptyNotice } from "../../ui/dom/index.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import type { SpaceMessageItem } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import { spaceRunOption } from "./mountSpaceNotes.js";
import { splitQuote } from "./discussionsActions.js";
import { renderDaySeparator, renderMessage, type MessageHost } from "./discussionsChat.js";
import { atBottom, canWriteDiscussions, discussionsSpaceId, scrollToBottom, type DiscussionsState, type ShownMessage } from "./discussionsState.js";

/** How long a message opened from elsewhere stays highlighted. */
const HIGHLIGHT_MS = 2000;

function dropShown(shown: ShownMessage): void {
  shown.editor.destroy(); shown.edit?.editor.destroy(); shown.node.remove();
}

export function destroyMessages(s: DiscussionsState): void {
  for (const shown of s.shown.values()) dropShown(shown);
  s.shown.clear(); s.days.clear(); s.pill.hidden = true;
}

/** A change of what is shown, so an unchanged item keeps its element and editor. */
const itemKey = (item: SpaceMessageItem): string => JSON.stringify([item.body, item.author, item.created, item.edited]);

/** Mounts the read-only editor of a message into a new body element, which `place` first puts in the message (the run status row goes beside it). */
function mountMessageBody(s: DiscussionsState, path: string, id: string, body: string, place: (mount: HTMLElement) => void): { mount: HTMLElement; editor: QmdEditorHandle } {
  const mount = renderElement("div", { class: "ds-message-body" });
  place(mount);
  const items = (): SpaceQmdItem[] => s.items ?? [];
  const editor = mountQmdEditor(mount, {
    body: splitQuote(body).rest, readOnly: true, onChange: () => {}, ...spaceRunOption(s.ctx, s.runs, s.math, path, id, mount, {
      earlier: () => items().slice(0, Math.max(items().findIndex(other => other.id === id), 0)).map(other => other.body),
      own: () => items().find(other => other.id === id)?.body ?? body,
    }),
  });
  return { mount, editor };
}

function mountShown(s: DiscussionsState, host: MessageHost, path: string, item: SpaceQmdItem): ShownMessage {
  let node: HTMLElement | undefined;
  const { mount, editor } = mountMessageBody(s, path, item.id, item.body, body => { node = renderMessage(host, item, body); });
  return { key: itemKey(item), item, node: node!, mount, editor };
}

/** Leaves the inline editor of a message, showing `body` read-only again. */
function closeEdit(s: DiscussionsState, shown: ShownMessage, body: string): void {
  const edit = shown.edit;
  if (!edit || s.selected === undefined) return;
  shown.edit = undefined; edit.editor.destroy();
  const { mount, editor } = mountMessageBody(s, s.selected, shown.item.id, body, next => edit.box.replaceWith(next));
  shown.mount = mount; shown.editor = editor;
}

/** Swaps the user's own message for an inline editor with Save and Cancel; Escape cancels, Mod+Enter saves, and saving posts editSpaceItem. */
export function editMessage(s: DiscussionsState, id: string): void {
  const shown = s.shown.get(id);
  const path = s.selected;
  if (!shown || shown.edit || path === undefined || !canWriteDiscussions(s)) return;
  const original = shown.item.body;
  const { rest } = splitQuote(original);
  const prefix = original.slice(0, original.length - rest.length);
  let draft = rest;
  const save = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Save" });
  const cancel = renderElement("button", { type: "button", class: "ls-btn", text: "Cancel" });
  const host = renderElement("div", { class: "ds-edit-editor" });
  const box = renderElement("div", { class: "ds-edit" }, host,
    renderElement("div", { class: "ds-edit-actions" }, renderElement("span", { class: "ds-hint", text: "Esc cancels · Ctrl+Enter saves" }), cancel, save));
  const submit = (): void => {
    if (!draft.trim() || !canWriteDiscussions(s) || s.selected !== path) return;
    const body = `${prefix}${draft}`;
    s.ctx.end.post({ type: "editSpaceItem", spaceId: discussionsSpaceId(s), path, id, body });
    closeEdit(s, shown, body);
  };
  shown.editor.destroy();
  shown.mount.replaceWith(box);
  const editor = mountQmdEditor(host, { body: rest, readOnly: false, onChange: body => { draft = body; save.disabled = !body.trim(); } });
  shown.edit = { box, editor };
  save.addEventListener("click", submit);
  cancel.addEventListener("click", () => closeEdit(s, shown, original));
  box.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeEdit(s, shown, original); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); editor.flush(); submit(); }
  }, true);
  editor.focus();
}

/** Asks to confirm, then posts removeSpaceItem; records made from the message stay as they are. */
export async function removeMessage(s: DiscussionsState, id: string): Promise<void> {
  const path = s.selected;
  if (path === undefined || !canWriteDiscussions(s)) return;
  const ok = await askDialog("Delete this message?", "It is removed for everyone in this Space. Agreements, tasks and saves made from it stay.", "Delete", true);
  if (ok && canWriteDiscussions(s) && s.selected === path) s.ctx.end.post({ type: "removeSpaceItem", spaceId: discussionsSpaceId(s), path, id });
}

/** Puts `nodes` in `parent` in order, moving only what is out of place and removing the rest, so kept elements stay mounted. */
function placeChildren(parent: HTMLElement, nodes: readonly HTMLElement[]): void {
  let at = parent.firstChild;
  for (const node of nodes) {
    if (node === at) { at = at.nextSibling; continue; }
    parent.insertBefore(node, at);
  }
  while (at) { const next = at.nextSibling; at.remove(); at = next; }
}

/** Scrolls to the message opened from elsewhere and highlights it briefly. */
export function revealFocused(s: DiscussionsState): void {
  const id = s.focusItem;
  if (id === undefined) return;
  s.focusItem = undefined;
  const node = [...s.messages.querySelectorAll<HTMLElement>(".ds-message")].find(element => element.dataset["itemId"] === id);
  if (!node) return;
  node.scrollIntoView?.({ block: "center" });
  node.classList.add("ds-highlight");
  setTimeout(() => node.classList.remove("ds-highlight"), HIGHLIGHT_MS);
}

/** Repaints the messages keyed by item id: unchanged ones keep their element and editor, new ones are appended, removed ones dropped, changed
 *  ones remounted. New messages keep a list at the bottom there (always after the user's own send); a scrolled-up list shows the pill instead. */
export function paintMessages(s: DiscussionsState, hostFor: (path: string) => MessageHost): void {
  const path = s.selected;
  if (!s.items || path === undefined) { destroyMessages(s); s.messages.replaceChildren(renderEmptyNotice({ text: "Loading messages…", inline: true })); return; }
  if (!s.items.length) { destroyMessages(s); s.messages.replaceChildren(renderEmptyNotice({ text: "No messages yet.", hint: "Write the first one below.", inline: true })); return; }
  const first = s.shown.size === 0;
  const bottom = atBottom(s.messages);
  const host = hostFor(path);
  const ids = new Set(s.items.map(item => item.id));
  for (const [id, shown] of s.shown) if (!ids.has(id)) { dropShown(shown); s.shown.delete(id); }
  const nodes: HTMLElement[] = [];
  const days = new Map<string, HTMLElement>();
  let day: string | undefined;
  let appended = false;
  let ownAppended = false;
  for (const item of s.items) {
    const itemDay = item.created && new Date(item.created).toDateString();
    if (item.created && itemDay && itemDay !== day) {
      day = itemDay;
      const separator = s.days.get(itemDay) ?? renderDaySeparator(item.created);
      days.set(itemDay, separator); nodes.push(separator);
    }
    let shown = s.shown.get(item.id);
    if (shown && shown.key !== itemKey(item)) { dropShown(shown); shown = undefined; }
    else if (!shown) { appended = true; ownAppended ||= item.author !== undefined && item.author === s.ctx.data.author; }
    if (!shown) { shown = mountShown(s, host, path, item); s.shown.set(item.id, shown); }
    shown.item = item;
    nodes.push(shown.node);
  }
  s.days = days;
  placeChildren(s.messages, nodes);
  if (first) { if (s.focusItem === undefined) scrollToBottom(s); }
  else if (appended) {
    if (bottom || s.sending || ownAppended) scrollToBottom(s); else s.pill.hidden = false;
    s.sending = false;
  }
  revealFocused(s);
}
