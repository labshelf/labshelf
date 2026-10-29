// Mounts the Discussions tab of a Space: the thread list with status filter and search, the open thread's messages and the reply box.
import { renderElement, renderEmptyNotice } from "../../ui/dom/index.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import type { SpaceThreadEntry, ThreadStatus } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { OverviewContext, SpaceBody } from "./mountOverview.js";
import { bindQmdCreate, paintQmdRows, qmdItemMeta, updateQmdSpace } from "./mountSpaceNotes.js";

/** The editor reports a change after this delay, so a reply sent by keyboard waits slightly longer for the latest draft. */
const DRAFT_SETTLE_MS = 350;
const STATUS_LABEL: Record<ThreadStatus, string> = { open: "Open", resolved: "Resolved" };

function threadMeta(thread: SpaceThreadEntry): string {
  return `${STATUS_LABEL[thread.status]} · ${thread.messages} ${thread.messages === 1 ? "message" : "messages"} · ${thread.updated}`;
}


interface DiscussionsDom {
  create: HTMLButtonElement;
  chips: HTMLButtonElement[];
  searchInput: HTMLInputElement;
  column: HTMLElement;
  detail: HTMLElement;
  head: HTMLElement;
  messages: HTMLElement;
  replyHost: HTMLElement;
  replyButton: HTMLButtonElement;
  replyBox: HTMLElement;
}

interface DiscussionsState extends DiscussionsDom {
  controller: AbortController;
  ctx: OverviewContext;
  threads: SpaceThreadEntry[] | undefined;
  status: ThreadStatus;
  search: string;
  selected: string | undefined;
  items: SpaceQmdItem[] | undefined;
  known: Set<string> | undefined;
  messageEditors: QmdEditorHandle[];
  reply: QmdEditorHandle | undefined;
  draft: string;
  sendTimer: ReturnType<typeof setTimeout> | undefined;
}

const discussionsSpaceId = (s: DiscussionsState): string => s.ctx.data.space.id;
const canWriteDiscussions = (s: DiscussionsState): boolean => !s.ctx.readOnly && !s.ctx.signal?.aborted;

function buildDiscussionsDom(root: HTMLElement, readOnly: boolean): DiscussionsDom {
  const create = renderElement("button", { type: "button", class: "ls-btn", text: "New topic", disabled: readOnly });
  const chips = (["open", "resolved"] as const).map(value =>
    renderElement("button", { type: "button", class: "ds-chip", text: STATUS_LABEL[value], "aria-pressed": String(value === "open") }));
  const searchInput = renderElement("input", { type: "search", class: "ls-input", "aria-label": "Search discussions", placeholder: "Search discussions" });
  const column = renderElement("section", { class: "ds-topics", "aria-label": "Topics" });
  const detail = renderElement("section", { class: "ds-detail", "aria-label": "Discussion thread" });
  const head = renderElement("div", { class: "ds-thread-head" });
  const messages = renderElement("div", { class: "ds-messages" });
  const replyHost = renderElement("div", { class: "ds-reply-editor" });
  const replyButton = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Reply", disabled: true });
  const replyBox = renderElement("div", { class: "ds-reply" }, replyHost, replyButton);
  root.replaceChildren(renderElement("div", { class: "discussions" },
    renderElement("header", { class: "ds-heading" }, renderElement("p", { text: "Discuss papers and keep decisions together." }), create),
    renderElement("div", { class: "ds-toolbar" }, renderElement("div", { role: "group", "aria-label": "Discussion status" }, ...chips), searchInput),
    renderElement("div", { class: "ds-layout" }, column, detail)));
  return { create, chips, searchInput, column, detail, head, messages, replyHost, replyButton, replyBox };
}

function buildDiscussionsState(root: HTMLElement, context: OverviewContext & { threads?: SpaceThreadEntry[] }): DiscussionsState {
  const controller = new AbortController();
  const ctx: OverviewContext = { data: context.data, end: context.end, readOnly: context.readOnly, signal: controller.signal };
  return {
    ...buildDiscussionsDom(root, ctx.readOnly), controller, ctx, threads: context.threads, status: "open", search: "", selected: undefined,
    items: undefined, known: undefined, messageEditors: [], reply: undefined, draft: "", sendTimer: undefined,
  };
}

function syncChips(s: DiscussionsState): void {
  s.chips.forEach((chip, at) => chip.setAttribute("aria-pressed", String(["open", "resolved"][at] === s.status)));
}

function visibleThreads(s: DiscussionsState): SpaceThreadEntry[] {
  const needle = s.search.trim().toLocaleLowerCase();
  return (s.threads ?? []).filter(thread => thread.status === s.status && thread.title.toLocaleLowerCase().includes(needle));
}

function paintTopics(s: DiscussionsState): void {
  const { threads, column } = s;
  if (!threads) { column.replaceChildren(renderEmptyNotice({ text: "Loading discussions…" })); return; }
  if (!threads.length) { column.replaceChildren(renderEmptyNotice({ text: "No discussions yet.", hint: "New topic starts a conversation about this Space.", inline: true })); return; }
  const rows = visibleThreads(s);
  if (!rows.length) {
    const text = s.search.trim() ? "No discussions match the search." : `No ${s.status} discussions.`;
    column.replaceChildren(renderEmptyNotice({ text, inline: true }));
    return;
  }
  paintQmdRows(column, "Topics", rows.map(thread => ({ path: thread.path, title: thread.title, meta: threadMeta(thread) })), s.selected, path => openTopic(s, path));
}

function syncReply(s: DiscussionsState): void {
  s.replyButton.disabled = s.ctx.readOnly || !s.draft.trim();
}

function sendReply(s: DiscussionsState): void {
  if (!canWriteDiscussions(s) || s.selected === undefined || !s.draft.trim()) return;
  s.ctx.end.post({ type: "addSpaceItem", spaceId: discussionsSpaceId(s), path: s.selected, body: s.draft });
  s.draft = ""; s.reply?.setBody(""); syncReply(s);
}

/** Wires the status chips, the search box and the reply button and shortcut. */
function wireDiscussionsControls(s: DiscussionsState): void {
  s.chips.forEach((chip, at) => chip.addEventListener("click", () => { s.status = (["open", "resolved"] as const)[at]!; syncChips(s); paintTopics(s); }));
  s.searchInput.addEventListener("input", () => { s.search = s.searchInput.value; paintTopics(s); });
  s.replyButton.addEventListener("click", () => sendReply(s));
  s.replyHost.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault(); event.stopPropagation();
    clearTimeout(s.sendTimer); s.sendTimer = setTimeout(() => sendReply(s), DRAFT_SETTLE_MS);
  }, true);
}

function mountReply(s: DiscussionsState): void {
  s.reply?.destroy();
  s.reply = mountQmdEditor(s.replyHost, { body: s.draft, readOnly: s.ctx.readOnly, onChange: body => { s.draft = body; syncReply(s); } });
  syncReply(s);
}

function paintHead(s: DiscussionsState): void {
  const thread = s.threads?.find(entry => entry.path === s.selected);
  if (!thread) { s.head.replaceChildren(); return; }
  const toggle = renderElement("button", { type: "button", class: "ls-btn", text: thread.status === "open" ? "Resolve" : "Reopen", disabled: s.ctx.readOnly });
  toggle.addEventListener("click", () => {
    if (canWriteDiscussions(s)) s.ctx.end.post({ type: "setThreadStatus", spaceId: discussionsSpaceId(s), path: thread.path, status: thread.status === "open" ? "resolved" : "open" });
  });
  s.head.replaceChildren(renderElement("h2", { text: thread.title }), renderElement("span", { class: "ds-status", text: STATUS_LABEL[thread.status] }), toggle);
}

function destroyMessages(s: DiscussionsState): void {
  for (const editor of s.messageEditors) editor.destroy();
  s.messageEditors = [];
}

function paintMessages(s: DiscussionsState): void {
  destroyMessages(s);
  if (!s.items) { s.messages.replaceChildren(renderEmptyNotice({ text: "Loading messages…", inline: true })); return; }
  const hosts = s.items.map(item => {
    const host = renderElement("article", { class: "ds-message" });
    s.messageEditors.push(mountQmdEditor(host, { body: item.body, readOnly: true, onChange: () => {}, meta: qmdItemMeta(item) }));
    return host;
  });
  s.messages.replaceChildren(...hosts);
}

function paintThread(s: DiscussionsState): void {
  clearTimeout(s.sendTimer); destroyMessages(s); s.reply?.destroy(); s.reply = undefined;
  if (s.selected === undefined) { s.detail.replaceChildren(renderEmptyNotice({ text: "No discussion selected.", hint: "Choose a topic in the list." })); return; }
  paintHead(s); paintMessages(s); mountReply(s);
  s.detail.replaceChildren(s.head, s.messages, s.replyBox);
}

function openTopic(s: DiscussionsState, path: string): void {
  if (path !== s.selected) s.draft = "";
  s.selected = path; s.items = undefined; paintTopics(s); paintThread(s);
  s.ctx.end.post({ type: "readSpaceQmd", spaceId: discussionsSpaceId(s), path });
}

/** Opens the topic that just appeared, first showing its status and clearing the search when the filters hide it. */
function revealAddedTopic(s: DiscussionsState, added: SpaceThreadEntry): void {
  s.known = undefined;
  if (!visibleThreads(s).some(thread => thread.path === added.path)) { s.status = added.status; s.search = ""; s.searchInput.value = ""; syncChips(s); }
  openTopic(s, added.path);
}

function setThreads(s: DiscussionsState, next: SpaceThreadEntry[]): void {
  s.threads = next;
  if (s.selected !== undefined && !next.some(thread => thread.path === s.selected)) { s.selected = undefined; s.items = undefined; s.draft = ""; paintThread(s); }
  else if (s.selected !== undefined) paintHead(s);
  paintTopics(s);
  const known = s.known;
  if (known) {
    const added = next.find(thread => !known.has(thread.path));
    if (added) revealAddedTopic(s, added);
  }
}

export function mountSpaceDiscussions(root: HTMLElement, context: OverviewContext & { threads?: SpaceThreadEntry[] }): SpaceBody {
  const s = buildDiscussionsState(root, context);
  wireDiscussionsControls(s);
  bindQmdCreate(s.create, s.ctx, "New topic", () => canWriteDiscussions(s), title => {
    s.known = new Set((s.threads ?? []).map(thread => thread.path));
    s.ctx.end.post({ type: "createSpaceThread", spaceId: discussionsSpaceId(s), title, body: "" });
  });
  const unsubscribe = s.ctx.end.subscribe(message => {
    if (message.type === "spaceDiscussions" && message.spaceId === discussionsSpaceId(s)) setThreads(s, message.threads);
    else if (message.type === "spaceQmd" && message.spaceId === discussionsSpaceId(s) && message.path === s.selected) { s.items = message.items; paintMessages(s); }
  });
  paintTopics(s); paintThread(s);

  return {
    update(data) { updateQmdSpace(s, data, () => { paintHead(s); if (s.selected !== undefined) mountReply(s); }); },
    dispose() { unsubscribe(); s.controller.abort(); clearTimeout(s.sendTimer); destroyMessages(s); s.reply?.destroy(); root.replaceChildren(); },
  };
}
