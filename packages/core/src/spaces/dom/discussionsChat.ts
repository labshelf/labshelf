// Renders the open conversation of the Discussions tab: its head with the More menu, the day separators, and each message with its avatar,
// its hover actions (Edit and Delete on the user's own), the quote it replies to and the records the Space kept of it, and the Rename topic dialog.
import { mountFormDialog, renderElement, showMenu, type IconName } from "../../ui/dom/index.js";
import { formatClockTime, formatDayLabel } from "../../time/index.js";
import type { SpaceMessageItem, SpaceThreadEntry, ThreadStatus } from "../spaceDiscussionsStore.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { SpaceSourceRef } from "../space.js";
import type { OverviewContext } from "./mountOverview.js";
import { isDeskFull, isOnDesk } from "./deskToggle.js";
import { meetingWhen, recordsOfMessage, splitQuote, type DiscussionsActionsHost } from "./discussionsActions.js";
import type { FollowRecord } from "./discussionsFollow.js";
import { renderIconButton, renderIconSpan, renderInitial } from "./discussionsViews.js";

/** What a message's actions and records need beyond the actions host. */
export interface MessageHost extends DiscussionsActionsHost {
  readonly path: string;
  save(ref: SpaceSourceRef): void;
  agree(ref: SpaceSourceRef, item: SpaceQmdItem): void;
  task(ref: SpaceSourceRef, item: SpaceQmdItem): void;
  meet(ref: SpaceSourceRef, item: SpaceQmdItem): void;
  show(record: FollowRecord): void;
  /** The topic item of the open topic, which has neither Edit nor Delete; absent in the Space chat. */
  readonly topicId?: string;
  /** Swaps the user's own message for an inline editor. */
  edit(item: SpaceQmdItem): void;
  /** Asks to confirm, then deletes the user's own message. */
  remove(item: SpaceQmdItem): void;
}

/** `Ana Silva, Bruno Costa and you` from the messages' authors, `me` last as you; empty without authors. */
export function participantsLabel(items: readonly SpaceQmdItem[], me: string | undefined): string {
  const authors = [...new Set(items.map(item => item.author).filter((name): name is string => !!name))];
  const others = authors.filter(name => name !== me);
  const names = others.length < authors.length ? [...others, others.length ? "you" : "You"] : others;
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What the conversation head needs: `thread` is absent for the Space chat, which has no More menu. */
export interface ThreadHead {
  readonly ctx: OverviewContext;
  readonly title: string;
  readonly subtitle: string;
  readonly thread: SpaceThreadEntry | undefined;
  readonly actions: HTMLElement[];
  back(): void;
  setStatus(status: ThreadStatus): void;
  /** Opens the Rename topic dialog; absent while the topic item is not read yet. */
  rename?(): void;
}

function threadMenu(head: ThreadHead, thread: SpaceThreadEntry): Parameters<typeof showMenu>[1] {
  const { ctx } = head;
  const pinned = isOnDesk(ctx, "thread", thread.path);
  const next: ThreadStatus = thread.status === "open" ? "resolved" : "open";
  return [
    { label: next === "resolved" ? "Resolve" : "Reopen", icon: "check", disabled: ctx.readOnly, onSelect: () => head.setStatus(next) },
    { label: "Rename topic…", icon: "edit", disabled: ctx.readOnly || !head.rename, onSelect: () => head.rename?.() },
    { label: pinned ? "Unpin from desk" : "Pin to desk", icon: "pin", disabled: ctx.readOnly || (!pinned && isDeskFull(ctx)),
      onSelect: () => ctx.end.post({ type: pinned ? "unpinFromDesk" : "pinToDesk", id: ctx.data.space.id, kind: "thread", ref: thread.path }) },
  ];
}

/** Back, the chat icon, the title over the participants, and the actions with More for a topic. */
export function renderThreadHead(head: ThreadHead): HTMLElement[] {
  const back = renderIconButton("arrow-left", "All conversations", "ds-icon-btn", true);
  back.addEventListener("click", () => head.back());
  const actions = [...head.actions];
  const thread = head.thread;
  if (thread) {
    const more = renderIconButton("more", "More actions", "ds-btn ds-more", true);
    more.addEventListener("click", () => showMenu(more, threadMenu(head, thread)));
    actions.push(more);
  }
  return [back, renderIconSpan("message", "ds-head-icon"),
    renderElement("div", { class: "ds-thread-title" }, renderElement("h2", { text: head.title }), renderElement("span", { class: "ds-status", text: head.subtitle })),
    renderElement("div", { class: "ds-heading-actions" }, ...actions)];
}

const isOwn = (host: MessageHost, item: SpaceQmdItem): boolean => host.ctx.data.author !== undefined && item.author === host.ctx.data.author;

/** Keeps a message's actions in one place: each turns the message into something the Space keeps; the user's own messages add Edit and Delete on a writable Space. */
function renderMessageActions(host: MessageHost, item: SpaceQmdItem, saved: boolean): HTMLElement {
  const ref = { path: host.path, itemId: item.id };
  const actions: Array<[IconName, string, () => void]> = [
    ["quote", "Reply quoting", () => host.quote(item)], ["pin", saved ? "Remove from saved" : "Save", () => host.save(ref)],
    ["check", "Record agreement", () => host.agree(ref, item)], ["check-square", "Create task", () => host.task(ref, item)],
    ["calendar", "Schedule meeting", () => host.meet(ref, item)],
  ];
  if (isOwn(host, item) && !host.ctx.readOnly && item.id !== host.topicId) actions.push(["edit", "Edit", () => host.edit(item)], ["trash", "Delete", () => host.remove(item)]);
  return renderElement("div", { class: "ds-msg-actions", role: "toolbar", "aria-label": "Message actions" }, ...actions.map(([name, label, run]) => {
    const button = renderIconButton(name, label, "ds-msg-action", true);
    button.disabled = host.ctx.readOnly;
    if (name === "pin") button.setAttribute("aria-pressed", String(saved));
    button.addEventListener("click", run);
    return button;
  }));
}

function recordLink(text: string, onClick: () => void, icon?: IconName): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ds-link", text }, icon ? renderIconSpan(icon) : "");
  button.addEventListener("click", onClick);
  return button;
}

/** Inside the bubble, under the text: the message's agreements, task chips and meeting cards. */
function renderMessageRecords(host: MessageHost, records: ReturnType<typeof recordsOfMessage>): HTMLElement | string {
  const nodes: HTMLElement[] = [];
  for (const agreement of records.agreements) {
    nodes.push(renderElement("span", { class: "ds-record" }, renderIconSpan("check"), "Agreement recorded · ",
      recordLink("View", () => host.show({ kind: "agreement", id: agreement.id }))));
  }
  for (const task of records.tasks) {
    const chip = renderElement("button", { type: "button", class: task.done ? "ds-task-chip done" : "ds-task-chip", title: "View task" }, renderIconSpan("check-square"),
      [task.title, task.assignee].filter(Boolean).join(" · "));
    chip.addEventListener("click", () => host.show({ kind: "task", id: task.id }));
    nodes.push(chip);
  }
  for (const meeting of records.meetings) {
    nodes.push(renderElement("div", { class: "ds-meeting-card" }, renderIconSpan("calendar"),
      renderElement("span", { class: "ds-meeting-text" }, renderElement("strong", { text: meeting.title }), renderElement("span", { text: meetingWhen(meeting) })),
      renderElement("span", { class: "ds-initials" }, ...(meeting.participants ?? []).map(name => renderInitial(name))),
      recordLink("View details", () => host.show({ kind: "meeting", id: meeting.id }), "arrow-right")));
  }
  return nodes.length ? renderElement("div", { class: "ds-records" }, ...nodes) : "";
}

/** The quoted message a reply starts with, as a bar with the author and the first line. */
function renderQuote(body: string): HTMLElement | string {
  const { quote } = splitQuote(body);
  return quote ? renderElement("blockquote", { class: "ds-quote" }, renderElement("strong", { text: quote.author }), ` · ${quote.text}`) : "";
}

/** The message frame around `body`, where the caller mounts the message's editor; the user's own messages sit on the right without an avatar, labelled You.
 *  The actions, records and saved mark sit in slots that refreshMessage repaints without touching `body`. */
export function renderMessage(host: MessageHost, item: SpaceMessageItem, body: HTMLElement): HTMLElement {
  const author = item.author ?? "Unknown";
  const own = isOwn(host, item);
  const slot = (name: string): HTMLElement => renderElement("div", { class: "ds-slot", "data-slot": name });
  const article = renderElement("article", { class: own ? "ds-message own" : "ds-message", "data-item-id": item.id }, own ? "" : renderInitial(author),
    renderElement("div", { class: "ds-msg-main" },
      renderElement("div", { class: "ds-msg-head" }, renderElement("strong", { text: own ? "You" : author }),
        item.created ? renderElement("time", { datetime: item.created, text: formatClockTime(item.created) }) : "",
        item.edited ? renderElement("span", { class: "ds-edited", title: item.edited, text: "(edited)" }) : ""),
      renderElement("div", { class: "ds-bubble" }, slot("actions"), renderQuote(item.body), body, slot("records")),
      slot("saved")));
  refreshMessage(host, item, article);
  return article;
}

/** Repaints the actions, records and saved mark of a message from the Space, leaving its body and editor as they are. */
export function refreshMessage(host: MessageHost, item: SpaceQmdItem, article: HTMLElement): void {
  const records = recordsOfMessage(host.ctx, { path: host.path, itemId: item.id });
  const fill = (name: string, node: HTMLElement | string): void => { article.querySelector(`[data-slot="${name}"]`)?.replaceChildren(node); };
  fill("actions", renderMessageActions(host, item, records.saved));
  fill("records", renderMessageRecords(host, records));
  fill("saved", records.saved ? renderElement("span", { class: "ds-record ds-saved" }, renderIconSpan("pin"), "Saved by you") : "");
}

/** The topic body with its `# title` heading replaced by `title`, the rest of its text kept; a body without a heading gets one on top. */
export function renameTopicBody(body: string, title: string): string {
  const heading = /^#[^\S\r\n]+[^\r\n]*/.exec(body);
  return heading ? `# ${title}${body.slice(heading[0].length)}` : `# ${title}\n\n${body}`;
}

/** The Rename topic dialog: one field with the current title; Save with a non-empty title runs `rename`. */
export function openRenameTopicDialog(ctx: OverviewContext, title: string, rename: (title: string) => void): () => void {
  const input = renderElement("input", { class: "ls-input", name: "title", value: title, "aria-label": "Title", required: true });
  const error = renderElement("p", { role: "alert" });
  const form = renderElement("form", { class: "ls-dialog ds-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Rename topic" },
    renderElement("h2", { text: "Rename topic" }), renderElement("label", {}, "Title", input), error);
  const close = mountFormDialog(form, { submitLabel: "Rename", ...(ctx.signal ? { signal: ctx.signal } : {}) });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = input.value.trim();
    if (!next) { error.textContent = "Enter a title."; return; }
    close();
    if (next !== title) rename(next);
  });
  input.focus(); input.select();
  return close;
}

/** A day separator before the first message of each day: `Today · November 4`, or the weekday and date. */
export function renderDaySeparator(iso: string): HTMLElement {
  const label = formatDayLabel(iso);
  const text = label === "Today" || label === "Yesterday" ? `${label} · ${new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : label;
  return renderElement("div", { class: "ds-day", role: "separator" }, renderElement("span", { text }));
}
