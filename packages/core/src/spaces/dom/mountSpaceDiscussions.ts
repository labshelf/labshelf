// Mounts the Discussions tab of a Space: a dashboard of its conversations (search in every message, the Space chat, recent activity, every topic
// with a status filter), the open conversation as a live chat with its composer and message actions, and the Follow up panel beside either.
import { renderElement, renderEmptyNotice, showMenu } from "../../ui/dom/index.js";
import { formatLocalDay } from "../../time/index.js";
import { mountQmdEditor } from "../../qmd/dom/index.js";
import { SPACE_CHAT_PATH, type DiscussionSearchHit, type SpaceThreadEntry } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { SpaceSourceRef } from "../space.js";
import type { OverviewContext, SpaceBody } from "./mountOverview.js";
import { bindQmdCreate, receiveCellMessage, updateQmdSpace } from "./mountSpaceNotes.js";
import { excerptOf, openAgreementDialog, openMeetingDialog, openTaskDialog, quoteOf } from "./discussionsActions.js";
import { renderFollowPanel, type FollowHost } from "./discussionsFollow.js";
import { STATUSES, STATUS_LABEL, continueThreads, renderContinueCard, renderConversationRow, renderGeneralChat, renderSearchHit } from "./discussionsViews.js";
import { openRenameTopicDialog, participantsLabel, refreshMessage, renameTopicBody, renderThreadHead, type MessageHost } from "./discussionsChat.js";
import { markRowPresence, paintOnlineMembers, typingText } from "./discussionsPresence.js";
import type { SpacePeer } from "../spacesHostPort.js";
import {
  atBottom, buildDiscussionsState, canWriteDiscussions, discussionsSpaceId, isChat, scrollToBottom, type DiscussionsState,
} from "./discussionsState.js";
import { destroyMessages, editMessage, paintMessages, removeMessage, revealFocused } from "./discussionsMessages.js";
import { linkedChatProjects, openSpaceProjectChat, renderProjectChatRows } from "./discussionsProjectChat.js";
import type { SpaceProjectEntry } from "../spaceViews.js";

/** The search asks the host this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 250;
/** The open conversation is marked seen at most this often while messages keep arriving. */
const SEEN_THROTTLE_MS = 2000;

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

/** The Space chat, then the chats of the linked shared projects. */
function paintGeneral(s: DiscussionsState): void {
  s.general.replaceChildren(renderGeneralChat(s.threads?.find(thread => isChat(thread.path)), () => openTopic(s, SPACE_CHAT_PATH)),
    renderProjectChatRows(linkedChatProjects(s.ctx.data), s.projectChat?.projectId, project => openProjectChat(s, project)));
}

function paintTopics(s: DiscussionsState): void {
  const { threads, column } = s;
  paintGeneral(s);
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

/** Shows the dashboard when no conversation is open, else the open one as a chat. */
function paintThread(s: DiscussionsState): void {
  destroyMessages(s); s.reply?.destroy(); s.reply = undefined;
  if (s.selected === undefined) {
    s.dashboard.querySelector(".ds-heading-actions")?.prepend(s.online, s.follow, s.savedButton);
    s.main.replaceChildren(s.dashboard);
    return;
  }
  paintHead(s); paintMessages(s, path => messageHost(s, path)); mountReply(s);
  s.typingLine.textContent = typingText(s.peers, s.selected);
  s.detail.replaceChildren(s.head, s.messages, s.pill, s.typingLine, s.replyBox);
  s.main.replaceChildren(s.detail);
}

/** Unmounts the open Project chat, if any; the caller paints what replaces it. */
function leaveProjectChat(s: DiscussionsState): void {
  s.projectChat?.dispose();
  s.projectChat = undefined;
}

/** Shows the project's chat in place of the dashboard or the open conversation. */
function openProjectChat(s: DiscussionsState, project: SpaceProjectEntry): void {
  if (s.selected !== undefined) closeTopic(s);
  leaveProjectChat(s);
  s.projectChat = openSpaceProjectChat(s.ctx.end, discussionsSpaceId(s), project, () => { leaveProjectChat(s); paintThread(s); paintGeneral(s); });
  s.main.replaceChildren(s.projectChat.node);
  paintGeneral(s);
}

/** Opens the conversation, at `itemId` when given; the same conversation already open only scrolls to it. */
function openTopic(s: DiscussionsState, path: string, itemId?: string): void {
  leaveProjectChat(s);
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
  s.items = items; paintHead(s); paintMessages(s, path => messageHost(s, path));
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
      // INVARIANT: a project chat closes once the Space unlinks the project or the project stops being shared.
      if (s.projectChat && !linkedChatProjects(s.ctx.data).some(project => project.projectId === s.projectChat?.projectId)) { leaveProjectChat(s); paintThread(s); }
      paintGeneral(s);
      paintHead(s); paintFollow(s);
      if (s.items && s.selected !== undefined) {
        const host = messageHost(s, s.selected);
        for (const shown of s.shown.values()) refreshMessage(host, shown.item, shown.node);
      }
    },
    dispose() { leaveProjectChat(s); s.presence.open(undefined); s.presence.dispose(); unsubscribe(); s.math.clear(); s.controller.abort(); clearTimeout(s.searchTimer); clearTimeout(s.seenTimer); destroyMessages(s); s.previews.destroy(); s.reply?.destroy(); root.replaceChildren(); },
  };
}
