// Mounts the Discussions tab of a Space: the thread list with status filter and search, the open thread's messages and the reply box.
import { renderElement, renderEmptyNotice } from "../../ui/dom/index.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/qmdEditor.js";
import type { SpaceThreadEntry, ThreadStatus } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { OverviewContext, SpaceBody } from "./mountOverview.js";
import { bindQmdCreate, paintQmdRows, qmdItemMeta, syncQmdReadOnly } from "./mountSpaceNotes.js";

/** The editor reports a change after this delay, so a reply sent by keyboard waits slightly longer for the latest draft. */
const DRAFT_SETTLE_MS = 350;
const STATUS_LABEL: Record<ThreadStatus, string> = { open: "Open", resolved: "Resolved" };

function threadMeta(thread: SpaceThreadEntry): string {
  return `${STATUS_LABEL[thread.status]} · ${thread.messages} ${thread.messages === 1 ? "message" : "messages"} · ${thread.updated}`;
}

export function mountSpaceDiscussions(root: HTMLElement, context: OverviewContext & { threads?: SpaceThreadEntry[] }): SpaceBody {
  let controller = new AbortController();
  const ctx: OverviewContext = { data: context.data, end: context.end, readOnly: context.readOnly, signal: controller.signal };
  let threads = context.threads;
  let status: ThreadStatus = "open";
  let search = "";
  let selected: string | undefined;
  let items: SpaceQmdItem[] | undefined;
  let known: Set<string> | undefined;
  let messageEditors: QmdEditorHandle[] = [];
  let reply: QmdEditorHandle | undefined;
  let draft = "";
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  const spaceId = (): string => ctx.data.space.id;
  const canWrite = (): boolean => !ctx.readOnly && !ctx.signal?.aborted;

  const create = renderElement("button", { type: "button", class: "ls-btn", text: "New topic", disabled: ctx.readOnly });
  const chips = (["open", "resolved"] as const).map(value => {
    const chip = renderElement("button", { type: "button", class: "ds-chip", text: STATUS_LABEL[value], "aria-pressed": String(value === status) });
    chip.addEventListener("click", () => { status = value; syncChips(); paintList(); });
    return chip;
  });
  const syncChips = (): void => chips.forEach((chip, at) => chip.setAttribute("aria-pressed", String(["open", "resolved"][at] === status)));
  const searchInput = renderElement("input", { type: "search", class: "ls-input", "aria-label": "Search discussions", placeholder: "Search discussions" });
  searchInput.addEventListener("input", () => { search = searchInput.value; paintList(); });
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

  const selectedThread = (): SpaceThreadEntry | undefined => threads?.find(thread => thread.path === selected);
  const visible = (): SpaceThreadEntry[] => {
    const needle = search.trim().toLocaleLowerCase();
    return (threads ?? []).filter(thread => thread.status === status && thread.title.toLocaleLowerCase().includes(needle));
  };

  const paintList = (): void => {
    if (!threads) { column.replaceChildren(renderEmptyNotice({ text: "Loading discussions…" })); return; }
    if (!threads.length) { column.replaceChildren(renderEmptyNotice({ text: "No discussions yet.", hint: "New topic starts a conversation about this Space.", inline: true })); return; }
    const rows = visible();
    if (!rows.length) {
      const text = search.trim() ? "No discussions match the search." : `No ${status} discussions.`;
      column.replaceChildren(renderEmptyNotice({ text, inline: true }));
      return;
    }
    paintQmdRows(column, "Topics", rows.map(thread => ({ path: thread.path, title: thread.title, meta: threadMeta(thread) })), selected, open);
  };

  const syncReply = (): void => { replyButton.disabled = ctx.readOnly || !draft.trim(); };
  const send = (): void => {
    if (!canWrite() || selected === undefined || !draft.trim()) return;
    ctx.end.post({ type: "addSpaceItem", spaceId: spaceId(), path: selected, body: draft });
    draft = ""; reply?.setBody(""); syncReply();
  };
  replyButton.addEventListener("click", send);
  replyHost.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault(); event.stopPropagation();
    clearTimeout(sendTimer); sendTimer = setTimeout(send, DRAFT_SETTLE_MS);
  }, true);

  const mountReply = (): void => {
    reply?.destroy();
    reply = mountQmdEditor(replyHost, { body: draft, readOnly: ctx.readOnly, onChange: body => { draft = body; syncReply(); } });
    syncReply();
  };

  const paintHead = (): void => {
    const thread = selectedThread();
    if (!thread) { head.replaceChildren(); return; }
    const toggle = renderElement("button", { type: "button", class: "ls-btn", text: thread.status === "open" ? "Resolve" : "Reopen", disabled: ctx.readOnly });
    toggle.addEventListener("click", () => {
      if (canWrite()) ctx.end.post({ type: "setThreadStatus", spaceId: spaceId(), path: thread.path, status: thread.status === "open" ? "resolved" : "open" });
    });
    head.replaceChildren(renderElement("h2", { text: thread.title }), renderElement("span", { class: "ds-status", text: STATUS_LABEL[thread.status] }), toggle);
  };

  const destroyMessages = (): void => { for (const editor of messageEditors) editor.destroy(); messageEditors = []; };
  const paintMessages = (): void => {
    destroyMessages();
    if (!items) { messages.replaceChildren(renderEmptyNotice({ text: "Loading messages…", inline: true })); return; }
    const hosts = items.map(item => {
      const host = renderElement("article", { class: "ds-message" });
      messageEditors.push(mountQmdEditor(host, { body: item.body, readOnly: true, onChange: () => {}, meta: qmdItemMeta(item) }));
      return host;
    });
    messages.replaceChildren(...hosts);
  };

  const paintDetail = (): void => {
    clearTimeout(sendTimer); destroyMessages(); reply?.destroy(); reply = undefined;
    if (selected === undefined) { detail.replaceChildren(renderEmptyNotice({ text: "No discussion selected.", hint: "Choose a topic in the list." })); return; }
    paintHead(); paintMessages(); mountReply();
    detail.replaceChildren(head, messages, replyBox);
  };

  const open = (path: string): void => {
    if (path !== selected) draft = "";
    selected = path; items = undefined; paintList(); paintDetail();
    ctx.end.post({ type: "readSpaceQmd", spaceId: spaceId(), path });
  };

  const setThreads = (next: SpaceThreadEntry[]): void => {
    threads = next;
    if (selected !== undefined && !next.some(thread => thread.path === selected)) { selected = undefined; items = undefined; draft = ""; paintDetail(); }
    else if (selected !== undefined) paintHead();
    paintList();
    if (known) {
      const added = next.find(thread => !known!.has(thread.path));
      if (added) {
        known = undefined;
        if (!visible().some(thread => thread.path === added.path)) { status = added.status; search = ""; searchInput.value = ""; syncChips(); }
        open(added.path);
      }
    }
  };

  bindQmdCreate(create, ctx, "New topic", canWrite, title => {
    known = new Set((threads ?? []).map(thread => thread.path));
    ctx.end.post({ type: "createSpaceThread", spaceId: spaceId(), title, body: "" });
  });

  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type === "spaceDiscussions" && message.spaceId === spaceId()) setThreads(message.threads);
    else if (message.type === "spaceQmd" && message.spaceId === spaceId() && message.path === selected) { items = message.items; paintMessages(); }
  });
  paintList(); paintDetail();

  return {
    update(data) {
      const next = syncQmdReadOnly(ctx, data, controller);
      if (!next) return;
      controller = next; create.disabled = ctx.readOnly;
      paintHead();
      if (selected !== undefined) mountReply();
    },
    dispose() { unsubscribe(); controller.abort(); clearTimeout(sendTimer); destroyMessages(); reply?.destroy(); root.replaceChildren(); },
  };
}
