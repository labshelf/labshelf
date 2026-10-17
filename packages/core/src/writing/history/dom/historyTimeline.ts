// Renders the history entries as a timeline grouped by day, newest first, with one selected entry.
import { escapeHtml } from "../../../ui/escapeHtml.js";
import { el } from "../../../ui/dom/dom.js";
import type { HistoryRow } from "../protocol/index.js";

const time = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateTime = (iso: string): string => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string): string {
  const day = new Date(iso).toDateString();
  const today = new Date();
  if (day === today.toDateString()) { return "Today"; }
  if (day === new Date(today.getTime() - 86_400_000).toDateString()) { return "Yesterday"; }
  return new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** What the row says it did: a version name, a restore or the files it touched. */
export function rowTitle(row: HistoryRow, oldest: boolean): string {
  if (row.kind === "version") { return `Version “${row.label ?? ""}”`; }
  if (row.kind === "restore") { return `Restored to ${row.label ? dateTime(row.label) : "an earlier point"}`; }
  if (oldest) { return "Start of history"; }
  const names = row.changes.map((change) => change.path.split("/").pop() ?? change.path);
  if (names.length === 0) { return "No file changes"; }
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function rowElement(row: HistoryRow, index: number, rows: readonly HistoryRow[], selected: boolean): HTMLElement {
  const badge = index === 0 ? `<span class="ls-history-badge">Current</span>` : "";
  return el("li", {
    class: `ls-history-row ls-history-${row.kind}${index === 0 ? " ls-history-current" : ""}`, role: "option", "aria-selected": String(selected), "data-index": index, tabindex: "-1",
    html: `<span class="ls-history-dot" aria-hidden="true"></span><span class="ls-history-time">${escapeHtml(time(row.at))}</span>` +
      `<span class="ls-history-title">${escapeHtml(rowTitle(row, index === rows.length - 1))}</span>${badge}`,
  });
}

/** Fills `list` with day headings and rows; the row at `selected` is marked and scrolled into view. */
export function renderTimeline(list: HTMLElement, rows: readonly HistoryRow[], selected: number): void {
  const items: HTMLElement[] = [];
  let day = "";
  rows.forEach((row, index) => {
    const label = dayLabel(row.at);
    if (label !== day) { items.push(el("li", { class: "ls-history-day", role: "presentation", text: label })); day = label; }
    items.push(rowElement(row, index, rows, index === selected));
  });
  list.replaceChildren(...items);
  list.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
}
