// Renders the dated parts of Home: the Needs you box, Recent in your Spaces, and Up next with its month calendar, list and calendar footer.
import { renderElement, renderIcon, type IconName } from "../../ui/dom/index.js";
import type { HomeAgendaRow, HomeRecentRow } from "../homeView.js";
import { notYet, relativeDay, shortDay, type HomeContext } from "./homeDesk.js";

const KIND_GLYPH: Partial<Record<HomeAgendaRow["kind"], IconName>> = { task: "check-square", read: "book-open", project: "file-text", deadline: "calendar", meeting: "users" };
const KIND_LABEL: Partial<Record<HomeAgendaRow["kind"], string>> = { task: "Task", read: "Reading goal", project: "Project goal", deadline: "Deadline", meeting: "Meeting" };
/** The verb of a row's action: reading goals are read, the rest opened. */
const KIND_VERB: Partial<Record<HomeAgendaRow["kind"], string>> = { read: "Read" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const meta = (row: HomeAgendaRow): string => [row.taskId ? "Personal task" : KIND_LABEL[row.kind] ?? "Date", row.spaceName ?? "Only you"].join(" · ");

function open(ctx: HomeContext, row: HomeAgendaRow): void {
  const target = row.target;
  if (!target) return;
  if (target.type === "paper") ctx.end.post({ type: "openPaper", paperId: target.paperId });
  else if (target.type === "project") ctx.end.post({ type: "openProject", projectId: target.projectId });
  else ctx.end.post({ type: "openSpace", id: target.id, tab: "overview" });
}

function verb(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "hm-accent hm-verb", text: `${label} ↗`, disabled });
  button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return button;
}

function rowShell(glyph: IconName, titleText: string, sub: HTMLElement, onOpen?: () => void): HTMLElement {
  const item = renderElement("li", { class: "hm-row" },
    renderElement("span", { class: "hm-row-glyph", "aria-hidden": "true", html: renderIcon(glyph) }),
    renderElement("div", { class: "hm-row-main" }, renderElement("strong", { class: "hm-row-title", text: titleText, title: titleText }), sub));
  if (onOpen) { item.classList.add("hm-openable"); item.addEventListener("click", onOpen); }
  return item;
}

function needsRow(ctx: HomeContext, row: HomeAgendaRow): HTMLElement {
  const sub = renderElement("span", { class: "hm-row-meta" }, meta(row), " · ", renderElement("span", { class: row.daysAway < 0 ? "hm-late" : "hm-today", text: relativeDay(row.daysAway) }));
  const item = rowShell(KIND_GLYPH[row.kind] ?? "calendar", row.title, sub, row.target ? () => open(ctx, row) : undefined);
  if (row.target) item.append(verb(KIND_VERB[row.kind] ?? "Open", () => open(ctx, row)));
  else if (row.taskId) {
    const id = row.taskId;
    item.append(verb("Done", () => ctx.end.post({ type: "home.completeTask", id }), ctx.view.readOnlyReason !== undefined));
  }
  return item;
}

const box = (...children: Array<HTMLElement | string>): HTMLElement => renderElement("div", { class: "hm-box" }, ...children);
const emptyLine = (text: string): HTMLElement => renderElement("p", { class: "hm-box-empty", text });

export function renderNeedsYou(ctx: HomeContext): HTMLElement {
  const rows = ctx.view.needsYou;
  return box(rows.length ? renderElement("ol", { class: "hm-list" }, ...rows.map((row) => needsRow(ctx, row)))
    : emptyLine("Nothing needs you today. Overdue tasks and today's dates from your Spaces appear here."));
}

/** "just now", "25 min ago", "3 h ago", "2 days ago". */
function ago(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (60 * 24));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function recentRow(ctx: HomeContext, row: HomeRecentRow): HTMLElement {
  const openSpace = (): void => { ctx.end.post({ type: "openSpace", id: row.spaceId, tab: row.kind === "note" ? "notes" : row.kind === "thread" ? "discussions" : "overview" }); };
  const object = renderElement("button", { type: "button", class: "hm-object", text: row.title, title: row.title });
  const paperId = row.paperId;
  object.addEventListener("click", (event) => {
    event.stopPropagation();
    if (paperId) ctx.end.post({ type: "openPaper", paperId }); else openSpace();
  });
  const item = renderElement("li", { class: "hm-row hm-recent hm-openable" },
    renderElement("span", { class: "hm-avatar", "aria-hidden": "true", text: (row.spaceName.trim()[0] ?? "?").toUpperCase() }),
    renderElement("div", { class: "hm-row-main" }, renderElement("strong", { class: "hm-row-title", text: row.label }), object,
      renderElement("span", { class: "hm-row-meta" }, `${row.spaceName} · `, renderElement("time", { datetime: row.at, text: ago(row.minutesAgo) }))));
  item.addEventListener("click", openSpace);
  return item;
}

export function renderRecent(ctx: HomeContext): HTMLElement {
  const rows = ctx.view.recent;
  return box(rows.length ? renderElement("ol", { class: "hm-list" }, ...rows.map((row) => recentRow(ctx, row))) : emptyLine("Nothing new in your Spaces yet."));
}

const pad = (n: number): string => String(n).padStart(2, "0");
const monthOf = (day: string): string => day.slice(0, 7);
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1 + by, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function calendar(ctx: HomeContext, repaint: () => void): HTMLElement {
  const today = ctx.view.today;
  const month = ctx.calendar.month ?? monthOf(today);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y ?? 1970, (m ?? 1) - 1, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const dated = new Set(ctx.view.calendar.map((row) => row.date));
  const step = (by: number) => (): void => { ctx.calendar.month = shiftMonth(month, by); repaint(); };
  const nav = (icon: IconName, label: string, by: number): HTMLButtonElement => {
    const button = renderElement("button", { type: "button", class: "ls-icon-btn hm-cal-nav", title: label, "aria-label": label, html: renderIcon(icon) });
    button.addEventListener("click", step(by));
    return button;
  };
  const todayLink = renderElement("button", { type: "button", class: "hm-accent", text: "Today" });
  todayLink.addEventListener("click", () => { ctx.calendar = {}; repaint(); });
  const grid = renderElement("div", { class: "hm-cal-grid", role: "grid", "aria-label": first.toLocaleDateString("en-US", { month: "long", year: "numeric" }) },
    ...WEEKDAYS.map((d) => renderElement("span", { class: "hm-cal-wd", text: d })),
    ...Array.from({ length: lead }, () => renderElement("span", {})));
  for (let d = 1; d <= days; d++) {
    const day = `${month}-${pad(d)}`;
    const cls = ["hm-cal-day", day === today ? "today" : "", dated.has(day) ? "has" : "", ctx.calendar.day === day ? "on" : ""].filter(Boolean).join(" ");
    const cell = renderElement("button", { type: "button", class: cls, text: String(d), "aria-pressed": String(ctx.calendar.day === day), title: dated.has(day) ? "Show this day" : "" });
    cell.addEventListener("click", () => { ctx.calendar.day = ctx.calendar.day === day ? undefined : day; repaint(); });
    grid.append(cell);
  }
  return renderElement("div", { class: "hm-cal" },
    renderElement("div", { class: "hm-cal-head" }, nav("chevron-left", "Previous month", -1),
      renderElement("div", { class: "hm-cal-month" }, renderElement("strong", { text: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }) }),
        renderElement("span", { text: ctx.calendar.day ? shortDay(ctx.calendar.day) : "All events" })),
      nav("chevron-right", "Next month", 1), todayLink),
    grid);
}

function upNextRow(ctx: HomeContext, row: HomeAgendaRow): HTMLElement {
  const item = rowShell(KIND_GLYPH[row.kind] ?? "calendar", row.title, renderElement("span", { class: "hm-row-meta", text: meta(row) }), row.target ? () => open(ctx, row) : undefined);
  item.append(renderElement("time", { class: `hm-row-day${row.daysAway < 0 ? " hm-late" : ""}`, datetime: row.date, title: relativeDay(row.daysAway),
    text: row.daysAway === 0 ? `Today${row.time ? ` · ${row.time}` : ""}` : `${shortDay(row.date)}${row.time ? ` · ${row.time}` : ""}` }));
  return item;
}

function calendarFoot(): HTMLElement {
  const setUp = renderElement("button", { type: "button", class: "hm-accent", text: "Set up ↗" });
  setUp.addEventListener("click", notYet);
  return renderElement("div", { class: "hm-cal-foot" },
    renderElement("span", { class: "hm-row-glyph", "aria-hidden": "true", html: renderIcon("link") }),
    renderElement("div", { class: "hm-row-main" }, renderElement("span", { text: "Connect your calendar to see busy times and send events." }),
      renderElement("span", { class: "hm-row-meta", text: "Google · Microsoft · CalDAV (Nextcloud)" })),
    setUp, renderElement("span", { class: "hm-cal-divider", "aria-hidden": "true" }),
    renderElement("span", { class: "hm-row-meta", text: "LabShelf calendar · no external account" }));
}

/** The Up next box; it repaints itself in place when the month or the chosen day changes. */
export function renderUpNext(ctx: HomeContext): HTMLElement {
  const holder = box();
  holder.classList.add("hm-next-box");
  const paint = (): void => {
    const day = ctx.calendar.day;
    const rows = day ? ctx.view.calendar.filter((row) => row.date === day) : ctx.view.upNext;
    const list = rows.length ? renderElement("ol", { class: "hm-list" }, ...rows.map((row) => upNextRow(ctx, row)))
      : emptyLine(day ? `Nothing on ${shortDay(day)}.` : "Nothing up next. Dates you add in your Spaces and tasks with a date appear here.");
    holder.replaceChildren(renderElement("div", { class: "hm-next-main" }, calendar(ctx, paint), renderElement("div", { class: "hm-next-list" }, list)), calendarFoot());
  };
  paint();
  return holder;
}
