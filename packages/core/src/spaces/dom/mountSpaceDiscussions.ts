// Mounts the Discussions tab of a Space: a dashboard of its conversations (search in every message, the Space chat, recent activity, every topic
// with a status filter), the open conversation as a live chat with its composer and message actions, and the Follow up panel beside either.
import { askDialog, renderElement, renderEmptyNotice, showMenu } from "../../ui/dom/index.js";
import { formatLocalDay } from "../../time/index.js";
import { createEvalMathBridge, mountQmdEditor, type CellRunGroup, type EvalMathBridge, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { SPACE_CHAT_PATH, type DiscussionSearchHit, type SpaceMessageItem, type SpaceThreadEntry, type ThreadStatus } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { SpaceSourceRef } from "../space.js";
import type { OverviewContext, SpaceBody } from "./mountOverview.js";
import { createDeskPreviews, type DeskPreviews } from "./overviewDesk.js";
import { bindQmdCreate, createSpaceCellRuns, receiveCellMessage, spaceRunOption, updateQmdSpace } from "./mountSpaceNotes.js";
import { excerptOf, openAgreementDialog, openMeetingDialog, openTaskDialog, quoteOf, splitQuote } from "./discussionsActions.js";
import { renderFollowPanel, type FollowHost, type FollowRecord, type FollowScope } from "./discussionsFollow.js";
import {
  STATUSES, STATUS_LABEL, buildDiscussionsDom, continueThreads, renderComposerTools, renderContinueCard, renderConversationRow, renderGeneralChat, renderSearchHit,
  type DiscussionsDom,
} from "./discussionsViews.js";
import {
  openRenameTopicDialog, participantsLabel, refreshMessage, renameTopicBody, renderDaySeparator, renderMessage, renderThreadHead, type MessageHost,
} from "./discussionsChat.js";
import {
  createConversationPresenceSender, markRowPresence, paintOnlineMembers, renderOnlineMembers, renderTypingLine, typingText, type ConversationPresenceSender,
} from "./discussionsPresence.js";
import type { SpacePeer } from "../spacesHostPort.js";

/** The search asks the host this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 250;
/** How long a message opened from elsewhere stays highlighted. */
const HIGHLIGHT_MS = 2000;
/** The open conversation is marked seen at most this often while messages keep arriving. */
const SEEN_THROTTLE_MS = 2000;
/** The message list counts as at the bottom this close to it, so new messages keep it there. */
const AT_BOTTOM_PX = 40;

/** A message on screen: the item it was painted from, its element, the mount of its read-only editor, and the inline editor while it is edited. */
interface ShownMessage {
  key: string;
  item: SpaceQmdItem;
  node: HTMLElement;
  mount: HTMLElement;
  editor: QmdEditorHandle;
  edit?: { box: HTMLElement; editor: QmdEditorHandle } | undefined;
}

interface DiscussionsState extends DiscussionsDom {
  controller: AbortController;
  ctx: OverviewContext;
  threads: SpaceThreadEntry[] | undefined;
  status: ThreadStatus;
  search: string;
  hits: DiscussionSearchHit[] | undefined;
  searchTimer: ReturnType<typeof setTimeout> | undefined;
  selected: string | undefined;
  /** The message to scroll to once the open conversation's items arrive. */
  focusItem: string | undefined;
  following: boolean;
  scope: FollowScope;
  followDetail: FollowRecord | undefined;
  items: SpaceQmdItem[] | undefined;
  /** The items of every conversation read so far, for the authors and the origin of records. */
  read: Map<string, SpaceQmdItem[]>;
  known: Set<string> | undefined;
  /** The messages on screen by item id, kept across repaints while their item is unchanged. */
  shown: Map<string, ShownMessage>;
  /** The day separators on screen by day. */
  days: Map<string, HTMLElement>;
  /** The open conversation's list entry as last read or matched; a different entry reads the items again. */
  entryKey: string | undefined;
  /** A read of the open conversation is in flight, and a change arrived while it was. */
  reading: boolean;
  readAgain: boolean;
  /** Items of the open conversation arrived since the last list snapshot, so that snapshot may only reflect them. */
  fresh: boolean;
  /** The user just sent: the next appended messages scroll to the bottom. */
  sending: boolean;
  /** Shown while new messages arrived below the scrolled-up list. */
  pill: HTMLButtonElement;
  /** The typeset last messages of the Continue cards. */
  previews: DeskPreviews;
  runs: CellRunGroup;
  math: EvalMathBridge;
  reply: QmdEditorHandle | undefined;
  draft: string;
  /** Enables or disables the composer's Σ and emoji buttons. */
  syncTools: () => void;
  /** When the open conversation was last marked seen, and the mark waiting out the throttle. */
  seenAt: number;
  seenTimer: ReturnType<typeof setTimeout> | undefined;
  /** The other members online in the Space, as the host last posted them. */
  peers: SpacePeer[];
  online: HTMLElement;
  typingLine: HTMLElement;
  presence: ConversationPresenceSender;
}

const discussionsSpaceId = (s: DiscussionsState): string => s.ctx.data.space.id;
const canWriteDiscussions = (s: DiscussionsState): boolean => !s.ctx.readOnly && !s.ctx.signal?.aborted;
const isChat = (path: string | undefined): boolean => path === SPACE_CHAT_PATH;

function buildDiscussionsState(root: HTMLElement, context: OverviewContext & { threads?: SpaceThreadEntry[] }): DiscussionsState {
  const controller = new AbortController();
  const ctx: OverviewContext = { data: context.data, end: context.end, readOnly: context.readOnly, signal: controller.signal };
  const dom = buildDiscussionsDom(root);
  dom.create.disabled = ctx.readOnly;
  const state: DiscussionsState = {
    ...dom, controller, ctx, threads: context.threads, status: "open", search: "", hits: undefined, searchTimer: undefined, selected: undefined,
    focusItem: undefined, following: true, scope: "space", followDetail: undefined, items: undefined, read: new Map(), known: undefined,
    shown: new Map(), days: new Map(), entryKey: undefined, reading: false, readAgain: false, fresh: false, sending: false, pill: renderNewMessagesPill(), previews: createDeskPreviews(), runs: createSpaceCellRuns(ctx), math: createEvalMathBridge(), reply: undefined, draft: "",
    syncTools: () => {}, seenAt: 0, seenTimer: undefined,
    peers: [], online: renderOnlineMembers(), typingLine: renderTypingLine(),
    presence: createConversationPresenceSender(ctx.end, ctx.data.space.id, () => !ctx.readOnly && !controller.signal.aborted),
  };
  // The tools reach the composer mounted when they are pressed.
  const tools = renderComposerTools(() => state.reply, () => ctx.readOnly);
  dom.toolsHost.replaceChildren(tools.tools);
  state.syncTools = tools.sync;
  return state;
}

function renderNewMessagesPill(): HTMLButtonElement {
  const pill = renderElement("button", { type: "button", class: "ds-new-pill", text: "New messages" });
  pill.hidden = true;
  return pill;
}

const atBottom = (list: HTMLElement): boolean => list.scrollHeight - list.scrollTop - list.clientHeight <= AT_BOTTOM_PX;

function scrollToBottom(s: DiscussionsState): void {
  s.messages.scrollTop = s.messages.scrollHeight;
  s.pill.hidden = true;
}

/** Tells the host the user has seen the open conversation, at most once per SEEN_THROTTLE_MS; never on a read-only Space. */
function markSeen(s: DiscussionsState): void {
  clearTimeout(s.seenTimer);
  if (!canWriteDiscussions(s) || s.selected === undefined) return;
  const wait = s.seenAt + SEEN_THROTTLE_MS - Date.now();
  if (wait > 0) { s.seenTimer = setTimeout(() => markSeen(s), wait); return; }
  s.seenAt = Date.now();
  s.ctx.end.post({ type: "markSeen", id: discussionsSpaceId(s), path: s.selected });
}

function syncChips(s: DiscussionsState): void {
  s.chips.forEach((chip, at) => chip.setAttribute("aria-pressed", String(STATUSES[at] === s.status)));
}

const matchesSearch = (s: DiscussionsState, thread: SpaceThreadEntry): boolean => thread.title.toLocaleLowerCase().includes(s.search.trim().toLocaleLowerCase());
const topics = (s: DiscussionsState): SpaceThreadEntry[] => (s.threads ?? []).filter(thread => !isChat(thread.path));

function visibleThreads(s: DiscussionsState): SpaceThreadEntry[] {
  return topics(s).filter(thread => thread.status === s.status && matchesSearch(s, thread));
}

const titleOf = (s: DiscussionsState, path: string): string => (isChat(path) ? "Space chat" : s.threads?.find(thread => thread.path === path)?.title ?? path);

/** Continue, or while the search box has text the messages that hold it. */
function paintRecent(s: DiscussionsState): void {
  s.previews.destroy();
  const query = s.search.trim();
  if (query) {
    const hits = s.hits;
    s.recent.hidden = false;
    s.recent.replaceChildren(renderElement("div", { class: "ds-section-head" }, renderElement("h3", { text: "Messages" })),
      !hits ? renderEmptyNotice({ text: "Searching…", inline: true })
        : hits.length ? renderElement("ul", { class: "ds-hits", "aria-label": "Messages" }, ...hits.map(hit => renderSearchHit(hit, query, ref => openTopic(s, ref.path, ref.itemId))))
          : renderEmptyNotice({ text: "No message matches the search.", inline: true }));
    return;
  }
  const recent = continueThreads(topics(s));
  s.recent.hidden = !recent.length;
  s.recent.replaceChildren(renderElement("div", { class: "ds-section-head" }, renderElement("h3", { text: "Continue" }), renderElement("p", { text: recent.some(thread => (thread.unread ?? 0) > 0) ? "New since your last visit" : "Topics with the latest activity" })),
    renderElement("div", { class: "ds-cards" }, ...recent.map(thread => renderContinueCard(thread, path => openTopic(s, path), s.previews))));
}

function paintTopics(s: DiscussionsState): void {
  const { threads, column } = s;
  s.general.replaceChildren(renderGeneralChat(threads?.find(thread => isChat(thread.path)), () => openTopic(s, SPACE_CHAT_PATH)));
  paintRecent(s);
  if (!threads) { column.replaceChildren(renderEmptyNotice({ text: "Loading discussions…" })); return; }
  if (!topics(s).length) { column.replaceChildren(renderEmptyNotice({ text: "No discussions yet.", hint: "New topic starts a conversation about this Space.", inline: true })); return; }
  const rows = visibleThreads(s);
  if (!rows.length) {
    const text = s.search.trim() ? "No discussions match the search." : `No ${s.status} discussions.`;
    column.replaceChildren(renderEmptyNotice({ text, inline: true }));
    return;
  }
  column.replaceChildren(renderElement("ul", { class: "ds-rows", "aria-label": "Topics" }, ...rows.map(thread => markRowPresence(renderConversationRow(thread, thread.path === s.selected, path => openTopic(s, path)), s.peers, thread.path))));
}

/** The names seen as authors, the user's own first. */
function people(s: DiscussionsState): string[] {
  const me = s.ctx.data.author;
  const authors = [...s.read.values()].flat().map(item => item.author).filter((name): name is string => !!name);
  return [...new Set([...(me ? [me] : []), ...authors])];
}

function quoteMessage(s: DiscussionsState, item: SpaceQmdItem): void {
  s.draft = `${quoteOf(item)}${s.draft}`;
  s.reply?.setBody(s.draft); syncReply(s); s.reply?.focus();
}

function followHost(s: DiscussionsState): FollowHost {
  return {
    ctx: s.ctx, scope: s.scope, detail: s.followDetail, selected: s.selected,
    people: () => people(s), quote: item => quoteMessage(s, item), titleOf: path => titleOf(s, path),
    itemOf: ref => s.read.get(ref.path)?.find(item => item.id === ref.itemId),
    setScope: scope => { s.scope = scope; paintFollow(s); },
    show: detail => { s.followDetail = detail; s.following = true; paintFollow(s); },
    close: () => { s.following = false; paintFollow(s); },
    openSource: ref => openTopic(s, ref.path, ref.itemId),
  };
}

function paintFollow(s: DiscussionsState): void {
  s.follow.setAttribute("aria-pressed", String(s.following));
  s.layout.classList.toggle("following", s.following);
  s.layout.replaceChildren(s.main, ...(s.following ? [renderFollowPanel(followHost(s), formatLocalDay(Date.now()))] : []));
}

/** Lists the messages the user saved in any conversation; choosing one opens it at the message. */
function showSaved(s: DiscussionsState): void {
  const mine = (s.ctx.data.space.saved ?? []).filter(entry => entry.by === s.ctx.data.author).sort((a, b) => b.created.localeCompare(a.created));
  const label = (ref: SpaceSourceRef): string => {
    const body = s.read.get(ref.path)?.find(item => item.id === ref.itemId)?.body;
    return body === undefined ? titleOf(s, ref.path) : `${titleOf(s, ref.path)} · ${excerptOf(body, 60)}`;
  };
  showMenu(s.savedButton, mine.length ? mine.map(entry => ({ label: label(entry), icon: "pin" as const, onSelect: () => openTopic(s, entry.path, entry.itemId) }))
    : [{ label: "No saved messages", disabled: true, onSelect: () => {} }]);
}

function syncReply(s: DiscussionsState): void {
  s.replyButton.disabled = s.ctx.readOnly || !s.draft.trim();
}

function sendReply(s: DiscussionsState): void {
  if (!canWriteDiscussions(s) || s.selected === undefined || !s.draft.trim()) return;
  s.ctx.end.post({ type: "addSpaceItem", spaceId: discussionsSpaceId(s), path: s.selected, body: s.draft });
  s.draft = ""; s.reply?.setBody(""); syncReply(s); s.sending = true;
  s.presence.sent();
}

/** Enter in the prose sends; Shift+Enter, a code cell, a source view or an open IME composition keep it a new line. */
function sendsOnEnter(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return false;
  const target = event.target as Element | null;
  return !target?.closest(".cm-editor, textarea");
}

function scheduleSearch(s: DiscussionsState): void {
  clearTimeout(s.searchTimer);
  s.hits = undefined;
  const query = s.search.trim();
  if (!query) return;
  s.searchTimer = setTimeout(() => s.ctx.end.post({ type: "searchDiscussions", spaceId: discussionsSpaceId(s), query }), SEARCH_DEBOUNCE_MS);
}

/** Wires Follow up, Saved, the status chips, the search box and the composer's button and Enter. */
function wireDiscussionsControls(s: DiscussionsState): void {
  s.follow.addEventListener("click", () => { s.following = !s.following; paintFollow(s); });
  s.savedButton.addEventListener("click", () => showSaved(s));
  s.chips.forEach((chip, at) => chip.addEventListener("click", () => { s.status = STATUSES[at]!; syncChips(s); paintTopics(s); }));
  s.searchInput.addEventListener("input", () => { s.search = s.searchInput.value; scheduleSearch(s); paintTopics(s); });
  s.replyButton.addEventListener("click", () => sendReply(s));
  s.pill.addEventListener("click", () => scrollToBottom(s));
  s.messages.addEventListener("scroll", () => { if (atBottom(s.messages)) s.pill.hidden = true; });
  s.replyHost.addEventListener("keydown", event => {
    if (!sendsOnEnter(event)) return;
    event.preventDefault(); event.stopPropagation();
    s.reply?.flush(); sendReply(s);
  }, true);
}

function mountReply(s: DiscussionsState): void {
  s.reply?.destroy();
  s.reply = mountQmdEditor(s.replyHost, {
    body: s.draft, readOnly: s.ctx.readOnly, placeholder: isChat(s.selected) ? "Message the Space…" : "Reply…",
    onChange: body => { s.draft = body; syncReply(s); s.presence.draftChanged(body.trim() !== ""); },
  });
  syncReply(s); s.syncTools();
}

function paintHead(s: DiscussionsState): void {
  const path = s.selected;
  const thread = s.threads?.find(entry => entry.path === path);
  if (path === undefined || (!thread && !isChat(path))) { s.head.replaceChildren(); return; }
  const people = participantsLabel(s.items ?? [], s.ctx.data.author);
  const topic = isChat(path) ? undefined : thread;
  const topicItem = topic ? s.items?.[0] : undefined;
  const rename = topic && topicItem ? () => openRenameTopicDialog(s.ctx, topic.title, title => {
    if (canWriteDiscussions(s)) s.ctx.end.post({ type: "editSpaceItem", spaceId: discussionsSpaceId(s), path: topic.path, id: topicItem.id, body: renameTopicBody(topicItem.body, title) });
  }) : undefined;
  s.head.replaceChildren(...renderThreadHead({
    ctx: s.ctx, thread: topic, title: titleOf(s, path), actions: [s.savedButton, s.follow],
    subtitle: topic ? [STATUS_LABEL[topic.status], people].filter(Boolean).join(" · ") : people || "Everyone in this Space",
    back: () => closeTopic(s),
    setStatus: status => { if (canWriteDiscussions(s) && topic) s.ctx.end.post({ type: "setThreadStatus", spaceId: discussionsSpaceId(s), path: topic.path, status }); },
    ...(rename ? { rename } : {}),
  }), s.online);
}

function dropShown(shown: ShownMessage): void {
  shown.editor.destroy(); shown.edit?.editor.destroy(); shown.node.remove();
}

function destroyMessages(s: DiscussionsState): void {
  for (const shown of s.shown.values()) dropShown(shown);
  s.shown.clear(); s.days.clear(); s.pill.hidden = true;
}

function messageHost(s: DiscussionsState, path: string): MessageHost {
  const write = (run: () => void) => { if (canWriteDiscussions(s)) run(); };
  const follow = followHost(s);
  return {
    ...follow, path,
    save: ref => write(() => s.ctx.end.post({ type: "toggleSaved", id: discussionsSpaceId(s), ...ref })),
    agree: (ref, item) => write(() => openAgreementDialog(s.ctx, { ...ref, body: item.body })),
    task: (ref, item) => write(() => openTaskDialog(follow, { ...ref, body: item.body })),
    meet: (ref, item) => write(() => openMeetingDialog(follow, { ...ref, body: item.body })),
    show: record => follow.show(record),
    ...(isChat(path) || !s.items?.[0] ? {} : { topicId: s.items[0].id }),
    edit: item => editMessage(s, item.id),
    remove: item => { void removeMessage(s, item.id); },
  };
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
function editMessage(s: DiscussionsState, id: string): void {
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
async function removeMessage(s: DiscussionsState, id: string): Promise<void> {
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
function revealFocused(s: DiscussionsState): void {
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
function paintMessages(s: DiscussionsState): void {
  const path = s.selected;
  if (!s.items || path === undefined) { destroyMessages(s); s.messages.replaceChildren(renderEmptyNotice({ text: "Loading messages…", inline: true })); return; }
  if (!s.items.length) { destroyMessages(s); s.messages.replaceChildren(renderEmptyNotice({ text: "No messages yet.", hint: "Write the first one below.", inline: true })); return; }
  const first = s.shown.size === 0;
  const bottom = atBottom(s.messages);
  const host = messageHost(s, path);
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

/** Shows the dashboard when no conversation is open, else the open one as a chat. */
function paintThread(s: DiscussionsState): void {
  destroyMessages(s); s.reply?.destroy(); s.reply = undefined;
  if (s.selected === undefined) {
    s.dashboard.querySelector(".ds-heading-actions")?.prepend(s.online, s.follow, s.savedButton);
    s.main.replaceChildren(s.dashboard);
    return;
  }
  paintHead(s); paintMessages(s); mountReply(s);
  s.typingLine.textContent = typingText(s.peers, s.selected);
  s.detail.replaceChildren(s.head, s.messages, s.pill, s.typingLine, s.replyBox);
  s.main.replaceChildren(s.detail);
}

/** Opens the conversation, at `itemId` when given; the same conversation already open only scrolls to it. */
function openTopic(s: DiscussionsState, path: string, itemId?: string): void {
  s.focusItem = itemId;
  if (path === s.selected && s.items) { revealFocused(s); return; }
  if (path !== s.selected) { s.draft = ""; s.seenAt = 0; }
  s.presence.open(path);
  s.selected = path; s.items = undefined; s.sending = false; paintTopics(s); paintThread(s); paintFollow(s);
  s.entryKey = entryKey(s.threads?.find(thread => thread.path === path));
  s.reading = false; s.readAgain = false; s.fresh = false;
  readOpen(s);
}

/** What of a list entry shows a change of the conversation's items; undefined while the file does not exist. */
const entryKey = (entry: SpaceThreadEntry | undefined): string | undefined =>
  entry && JSON.stringify([entry.messages, entry.updated, entry.last?.body, entry.last?.author, entry.last?.created]);

/** Asks for the open conversation's items; at most one read is in flight, and a change meanwhile reads once more after it. */
function readOpen(s: DiscussionsState): void {
  if (s.selected === undefined) return;
  if (s.reading) { s.readAgain = true; return; }
  s.reading = true;
  s.ctx.end.post({ type: "readSpaceQmd", spaceId: discussionsSpaceId(s), path: s.selected });
}

/** Whether the entry's count and last message are those of the items on screen. */
function entryMatchesShown(s: DiscussionsState, entry: SpaceThreadEntry): boolean {
  const items = s.items ?? [];
  const last = items.at(-1);
  const lastBody = entry.last?.body;
  return entry.messages === (isChat(s.selected) ? items.length : Math.max(items.length - 1, 0)) && last?.author === entry.last?.author
    && last?.created === entry.last?.created && (lastBody === undefined ? last === undefined : last?.body.slice(0, lastBody.length) === lastBody);
}

/** Reads the open conversation again when its list entry changed, unless items just read already show the change. */
function followOpenEntry(s: DiscussionsState, entry: SpaceThreadEntry | undefined): void {
  const key = entryKey(entry);
  if (key === s.entryKey) return;
  s.entryKey = key;
  if (s.fresh && entry && s.items && entryMatchesShown(s, entry)) return;
  readOpen(s);
}

function closeTopic(s: DiscussionsState): void {
  clearTimeout(s.seenTimer);
  s.presence.open(undefined);
  s.selected = undefined; s.items = undefined; s.draft = ""; s.scope = "space";
  s.entryKey = undefined; s.reading = false; s.readAgain = false; s.fresh = false; s.sending = false;
  paintTopics(s); paintThread(s); paintFollow(s);
}

/** Opens the topic that just appeared, first showing its status and clearing the search when the filters hide it. */
function revealAddedTopic(s: DiscussionsState, added: SpaceThreadEntry): void {
  s.known = undefined;
  if (!visibleThreads(s).some(thread => thread.path === added.path)) { s.status = added.status; s.search = ""; s.searchInput.value = ""; syncChips(s); }
  openTopic(s, added.path);
}

/** The Space chat stays open while its file does not exist yet. */
function setThreads(s: DiscussionsState, next: SpaceThreadEntry[]): void {
  s.threads = next;
  if (s.selected !== undefined && !isChat(s.selected) && !next.some(thread => thread.path === s.selected)) closeTopic(s);
  else if (s.selected !== undefined) { paintHead(s); followOpenEntry(s, next.find(thread => thread.path === s.selected)); }
  s.fresh = false;
  paintTopics(s);
  const known = s.known;
  if (known) {
    const added = next.find(thread => !known.has(thread.path) && !isChat(thread.path));
    if (added) revealAddedTopic(s, added);
  }
}

function receiveItems(s: DiscussionsState, path: string, items: SpaceQmdItem[]): void {
  s.read.set(path, items);
  if (path !== s.selected) return;
  s.reading = false; s.fresh = true;
  const before = s.items && new Set(s.items.map(item => item.id));
  s.items = items; paintHead(s); paintMessages(s);
  // The conversation is seen once its messages are on screen: when it opens, and when new ones arrive while it is open.
  if (!before || items.some(item => !before.has(item.id))) markSeen(s);
  if (s.readAgain) { s.readAgain = false; readOpen(s); }
}

/** Repaints the header's members, the typing line and the row dots; the messages and the composer stay as they are. */
function receivePeers(s: DiscussionsState, peers: SpacePeer[]): void {
  s.peers = peers;
  paintOnlineMembers(s.online, peers);
  s.typingLine.textContent = typingText(peers, s.selected);
  paintTopics(s);
}

function receiveHits(s: DiscussionsState, query: string, hits: DiscussionSearchHit[]): void {
  if (query !== s.search.trim()) return;
  s.hits = hits; paintRecent(s);
}

/** `path` opens that topic once mounted, under the status filter it belongs to. */
export function mountSpaceDiscussions(root: HTMLElement, context: OverviewContext & { threads?: SpaceThreadEntry[]; path?: string }): SpaceBody {
  const s = buildDiscussionsState(root, context);
  wireDiscussionsControls(s);
  bindQmdCreate(s.create, s.ctx, "New topic", () => canWriteDiscussions(s), title => {
    s.known = new Set((s.threads ?? []).map(thread => thread.path));
    s.ctx.end.post({ type: "createSpaceThread", spaceId: discussionsSpaceId(s), title, body: "" });
  });
  const unsubscribe = s.ctx.end.subscribe(message => {
    const own = "spaceId" in message && message.spaceId === discussionsSpaceId(s);
    if (message.type === "spaceDiscussions" && own) setThreads(s, message.threads);
    else if (message.type === "spaceQmd" && own) receiveItems(s, message.path, message.items);
    else if (message.type === "discussionSearch" && own) receiveHits(s, message.query, message.hits);
    else if (message.type === "spacePresence" && own) receivePeers(s, message.peers);
    else receiveCellMessage(s, message);
  });
  const status = context.path === undefined ? undefined : s.threads?.find(thread => thread.path === context.path)?.status;
  if (status) { s.status = status; syncChips(s); }
  paintTopics(s); paintThread(s); paintFollow(s);
  if (context.path) openTopic(s, context.path);

  return {
    // The head, the messages' action bars and records, and Follow up repaint on every snapshot, since desk pins, saves, agreements and dates
    // change only the Space; the message editors stay mounted.
    update(data) {
      updateQmdSpace(s, data, () => { if (s.selected !== undefined) mountReply(s); });
      paintHead(s); paintFollow(s);
      if (s.items && s.selected !== undefined) {
        const host = messageHost(s, s.selected);
        for (const shown of s.shown.values()) refreshMessage(host, shown.item, shown.node);
      }
    },
    dispose() { s.presence.open(undefined); s.presence.dispose(); unsubscribe(); s.math.clear(); s.controller.abort(); clearTimeout(s.searchTimer); clearTimeout(s.seenTimer); destroyMessages(s); s.previews.destroy(); s.reply?.destroy(); root.replaceChildren(); },
  };
}
