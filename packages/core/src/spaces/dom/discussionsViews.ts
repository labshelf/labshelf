// Builds and renders the parts of the Discussions tab: the dashboard and chat frame, the Space chat card, the conversation cards with the last
// message typeset on a sheet, the rows and the search hits, the composer's Σ and emoji buttons, and the icons, buttons and initials the chat and
// Follow up share.
import { renderElement, renderIcon, showPopover, type IconName } from "../../ui/dom/index.js";
import type { QmdEditorHandle } from "../../qmd/dom/index.js";
import { formatClockTime, formatDayLabel, formatShortDate } from "../../time/index.js";
import type { DiscussionSearchHit, SpaceThreadEntry, ThreadStatus } from "../spaceDiscussionsStore.js";
import type { SpaceSourceRef } from "../space.js";
import { excerptOf, splitQuote } from "./discussionsActions.js";
import type { DeskPreviews } from "./overviewDesk.js";

export const STATUS_LABEL: Record<ThreadStatus, string> = { open: "Open", resolved: "Resolved" };
export const STATUSES = ["open", "resolved"] as const;
/** How many recently active topics Continue shows. */
const CONTINUE_LIMIT = 2;

export const renderIconSpan = (name: IconName, className = "ds-icon"): HTMLElement =>
  renderElement("span", { class: className, "aria-hidden": "true", html: renderIcon(name) });

/** A button with a leading icon; `label` is the visible text, or the accessible name when `iconOnly`. */
export function renderIconButton(name: IconName, label: string, className: string, iconOnly = false): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, ...(iconOnly ? { "aria-label": label, title: label } : {}) }, renderIconSpan(name));
  if (!iconOnly) button.append(label);
  return button;
}

/** A gray square with the first letter of `name`, for authors and participants. */
export function renderInitial(name: string): HTMLElement {
  return renderElement("span", { class: "ds-avatar", role: "img", "aria-label": name, title: name, text: (name.trim()[0] ?? "?").toUpperCase() });
}

/** How long the excerpt of a thread's last message may be. */
const LAST_EXCERPT = 90;

/** `Author: excerpt` of the thread's last message, or `fallback` without one. */
function lastLine(thread: SpaceThreadEntry | undefined, fallback: string): string {
  const last = thread?.last;
  if (!last) return fallback;
  const text = excerptOf(splitQuote(last.body).rest, LAST_EXCERPT);
  return last.author ? `${last.author}: ${text}` : text;
}

/** Today's time of day, else the short date. */
function whenLabel(iso: string): string {
  return formatDayLabel(iso) === "Today" ? formatClockTime(iso) : formatShortDate(iso);
}

const messagesLabel = (count: number): string => `${count} ${count === 1 ? "message" : "messages"}`;
const unreadOf = (thread: SpaceThreadEntry | undefined): number => thread?.unread ?? 0;
/** `N new` (or `N new messages` when `long`) in the link colour while the thread has unread messages, else its count. */
function countLabel(thread: SpaceThreadEntry, long: boolean): HTMLElement {
  const unread = unreadOf(thread);
  return unread ? renderElement("span", { class: "ds-new", text: long ? `${unread} new ${unread === 1 ? "message" : "messages"}` : `${unread} new` })
    : renderElement("span", { text: messagesLabel(thread.messages) });
}

/** The Space chat everyone in the Space shares, with its last message; `chat` is its entry once the file exists. */
export function renderGeneralChat(chat: SpaceThreadEntry | undefined, open: () => void): HTMLElement {
  const button = renderElement("button", { type: "button", class: "ds-link", text: "Open" }, renderIconSpan("arrow-right"));
  button.addEventListener("click", open);
  return renderElement("section", { class: "ds-general", "aria-label": "Space chat" }, renderIconSpan("message", "ds-general-icon"),
    renderElement("div", { class: "ds-general-text" }, renderElement("strong", { text: "Space chat" }), renderElement("span", { text: lastLine(chat, "No messages yet.") })),
    chat ? renderElement("span", { class: "ds-general-meta" }, renderElement("span", { text: `${formatDayLabel(chat.updated)}, ${formatClockTime(chat.updated)}` }),
      countLabel(chat, false)) : "", button);
}

/** The open topics with unread messages first, then the most recently active, newest first. */
export function continueThreads(threads: readonly SpaceThreadEntry[]): SpaceThreadEntry[] {
  return threads.filter(thread => thread.status === "open")
    .sort((a, b) => Number(unreadOf(b) > 0) - Number(unreadOf(a) > 0) || b.updated.localeCompare(a.updated)).slice(0, CONTINUE_LIMIT);
}

/** A recent topic: its kind and title, its last message typeset on a sheet and as `Author: excerpt`, and its count. */
export function renderContinueCard(thread: SpaceThreadEntry, open: (path: string) => void, previews: DeskPreviews): HTMLElement {
  const title = renderElement("button", { type: "button", class: "ds-card-open", text: thread.title });
  title.addEventListener("click", () => open(thread.path));
  const sheet = renderElement("div", { class: "ds-card-sheet ov-note-body", "aria-hidden": "true" });
  if (thread.last) previews.mount(sheet, splitQuote(thread.last.body).rest);
  return renderElement("article", { class: "ds-card" },
    renderElement("span", { class: "ds-kind", text: `Topic · ${STATUS_LABEL[thread.status]}` }), title, thread.last ? sheet : "",
    renderElement("span", { class: "ds-card-last", text: lastLine(thread, `Updated ${whenLabel(thread.updated)}`) }),
    renderElement("span", { class: "ds-card-foot" }, countLabel(thread, true), renderIconSpan("arrow-right")));
}

export function renderConversationRow(thread: SpaceThreadEntry, selected: boolean, open: (path: string) => void): HTMLElement {
  const unread = unreadOf(thread);
  const button = renderElement("button", { type: "button", class: unread ? "ds-row unread" : "ds-row", "data-path": thread.path, "aria-current": selected ? "true" : undefined },
    renderIconSpan("message"),
    renderElement("span", { class: "ds-row-title" }, renderElement("strong", { text: thread.title }),
      renderElement("span", { text: `Topic · ${STATUS_LABEL[thread.status]} · ${messagesLabel(thread.messages)}` })),
    renderElement("span", { class: "ds-row-meta", text: lastLine(thread, "") }),
    renderElement("span", { class: "ds-row-end" }, renderElement("time", { class: "ds-row-when", datetime: thread.updated, text: whenLabel(thread.updated) }),
      unread ? renderElement("span", { class: "ds-badge", "aria-label": `${unread} new`, text: String(unread) }) : ""));
  button.addEventListener("click", () => open(thread.path));
  return renderElement("li", {}, button);
}

/** The excerpt with each match of `query` marked. */
function markedExcerpt(excerpt: string, query: string): HTMLElement {
  const out = renderElement("span", { class: "ds-hit-excerpt" });
  const needle = query.trim().toLocaleLowerCase();
  let from = 0;
  for (let at = excerpt.toLocaleLowerCase().indexOf(needle); needle && at >= 0; at = excerpt.toLocaleLowerCase().indexOf(needle, from)) {
    out.append(excerpt.slice(from, at), renderElement("mark", { text: excerpt.slice(at, at + needle.length) }));
    from = at + needle.length;
  }
  out.append(excerpt.slice(from));
  return out;
}

/** One search hit: its conversation, who wrote it when, and the excerpt around the match. */
export function renderSearchHit(hit: DiscussionSearchHit, query: string, open: (ref: SpaceSourceRef) => void): HTMLElement {
  const meta = [hit.author, hit.created && whenLabel(hit.created)].filter(Boolean).join(" · ");
  const button = renderElement("button", { type: "button", class: "ds-hit" }, renderElement("strong", { text: hit.title }),
    meta ? renderElement("span", { class: "ds-hit-meta", text: meta }) : "", markedExcerpt(hit.excerpt, query));
  button.addEventListener("click", () => open({ path: hit.path, itemId: hit.itemId }));
  return renderElement("li", {}, button);
}

export interface DiscussionsDom {
  layout: HTMLElement;
  main: HTMLElement;
  follow: HTMLButtonElement;
  savedButton: HTMLButtonElement;
  create: HTMLButtonElement;
  dashboard: HTMLElement;
  chips: HTMLButtonElement[];
  searchInput: HTMLInputElement;
  general: HTMLElement;
  recent: HTMLElement;
  column: HTMLElement;
  detail: HTMLElement;
  head: HTMLElement;
  messages: HTMLElement;
  replyHost: HTMLElement;
  replyButton: HTMLButtonElement;
  /** Where the composer's insert buttons go, left of Send. */
  toolsHost: HTMLElement;
  replyBox: HTMLElement;
}

function buildDashboard(): Pick<DiscussionsDom, "dashboard" | "follow" | "savedButton" | "create" | "chips" | "searchInput" | "general" | "recent" | "column"> {
  const follow = renderIconButton("calendar", "Follow up", "ds-btn ds-follow-toggle");
  const savedButton = renderIconButton("pin", "Saved", "ds-btn");
  const create = renderIconButton("plus", "New topic", "ds-btn");
  const chips = STATUSES.map(value =>
    renderElement("button", { type: "button", class: "ds-chip", text: STATUS_LABEL[value], "aria-pressed": String(value === "open") }));
  const searchInput = renderElement("input", { type: "search", class: "ls-input", "aria-label": "Find in all conversations", placeholder: "Find in all conversations…" });
  const general = renderElement("div");
  const recent = renderElement("section", { class: "ds-section", "aria-label": "Continue" });
  const column = renderElement("div", { class: "ds-topics" });
  const dashboard = renderElement("div", { class: "ds-dashboard" },
    renderElement("header", { class: "ds-heading" },
      renderElement("div", {}, renderElement("h2", { text: "Discussions" }), renderElement("p", { text: "Space, project and comment conversations in one place." })),
      renderElement("div", { class: "ds-heading-actions" }, follow, savedButton, create)),
    renderElement("label", { class: "ds-search" }, renderIconSpan("search"), searchInput),
    general, recent,
    renderElement("section", { class: "ds-section", "aria-label": "All conversations" },
      renderElement("div", { class: "ds-section-head" }, renderElement("h3", { text: "All conversations" }),
        renderElement("div", { role: "group", "aria-label": "Discussion status" }, ...chips)),
      column));
  return { dashboard, follow, savedButton, create, chips, searchInput, general, recent, column };
}

export function buildDiscussionsDom(root: HTMLElement): DiscussionsDom {
  const detail = renderElement("section", { class: "ds-detail", "aria-label": "Discussion thread" });
  const head = renderElement("header", { class: "ds-thread-head" });
  const messages = renderElement("div", { class: "ds-messages" });
  const replyHost = renderElement("div", { class: "ds-reply-editor" });
  const replyButton = renderIconButton("send", "Send", "ds-send", true);
  const toolsHost = renderElement("div", { class: "ds-composer-tools-host" });
  const replyBox = renderElement("div", { class: "ds-reply" }, renderElement("div", { class: "ds-composer" }, replyHost, toolsHost, replyButton),
    renderElement("span", { class: "ds-hint", text: "Enter sends · Shift+Enter new line" }));
  const main = renderElement("div", { class: "ds-main" });
  const layout = renderElement("div", { class: "discussions" }, main);
  root.replaceChildren(layout);
  return { ...buildDashboard(), layout, main, detail, head, messages, replyHost, replyButton, toolsHost, replyBox };
}

/** Common Unicode emoji, so the grid needs no picker dependency. */
const COMPOSER_EMOJI = [
  "😀", "😄", "😂", "🙂", "😉", "😊", "😍", "🤔", "😅", "😬", "😮", "😢", "😴", "🙃", "😎", "🤯",
  "👍", "👎", "👏", "🙌", "🙏", "👀", "💪", "🤝", "👋", "✌️", "❤️", "🔥", "✨", "🎉", "🚀", "💡",
  "✅", "❌", "⚠️", "❓", "📌", "📎", "📊", "📝",
] as const;

/** Opens the emoji grid under `anchor`; a choice closes it, then `choose` runs. Escape and a click outside close it too. */
export function openEmojiGrid(anchor: HTMLElement, choose: (emoji: string) => void): void {
  showPopover(anchor, (close) => renderElement("div", { class: "ls-menu ds-emoji-grid", role: "group", "aria-label": "Emoji" },
    ...COMPOSER_EMOJI.map((emoji) => {
      const button = renderElement("button", { type: "button", class: "ds-emoji", text: emoji, "aria-label": emoji });
      button.addEventListener("click", () => { close(); choose(emoji); });
      return button;
    })));
}

/** The Σ and emoji buttons, for the composer left of Send; `reply` is the composer's editor while one is mounted. */
export function renderComposerTools(reply: () => QmdEditorHandle | undefined, readOnly: () => boolean): { tools: HTMLElement; sync(): void } {
  const math = renderIconButton("sigma", "Insert inline math", "ds-icon-btn ds-composer-tool", true);
  const emoji = renderIconButton("smile", "Insert emoji", "ds-icon-btn ds-composer-tool", true);
  emoji.setAttribute("aria-haspopup", "true");
  // Pressing a tool keeps the caret in the composer, where the insertion goes.
  for (const button of [math, emoji]) button.addEventListener("mousedown", (event) => event.preventDefault());
  math.addEventListener("click", () => reply()?.insertInlineMath());
  emoji.addEventListener("click", () => openEmojiGrid(emoji, (chosen) => reply()?.insertText(chosen)));
  const sync = (): void => { math.disabled = emoji.disabled = readOnly(); };
  return { tools: renderElement("div", { class: "ds-composer-tools" }, math, emoji), sync };
}
