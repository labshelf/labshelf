// Mounts the project history page: a timeline to step through, the selected entry's changes and the restore action.
import { renderElement } from "../../../ui/dom/dom.js";
import { renderIcon } from "../../../ui/icons/index.js";
import type { HistoryRow, HistoryTransport, HostToHistory } from "../protocol/index.js";
import { escapeHtml } from "../../../ui/escapeHtml.js";
import type { DiffLine } from "../lineDiff.js";

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
function rowTitle(row: HistoryRow, oldest: boolean): string {
  if (row.kind === "version") { return `Version “${row.label ?? ""}”`; }
  if (row.kind === "restore") { return `Restored to ${row.label ? dateTime(row.label) : "an earlier point"}`; }
  if (oldest) { return "Start of history"; }
  const names = row.changes.map((change) => change.path.split("/").pop() ?? change.path);
  if (names.length === 0) { return "No file changes"; }
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function rowElement(row: HistoryRow, index: number, rows: readonly HistoryRow[], selected: boolean): HTMLElement {
  const badge = index === 0 ? `<span class="ls-history-badge">Current</span>` : "";
  return renderElement("li", {
    class: `ls-history-row ls-history-${row.kind}${index === 0 ? " ls-history-current" : ""}`, role: "option", "aria-selected": String(selected), "data-index": index, tabindex: "-1",
    html: `<span class="ls-history-dot" aria-hidden="true"></span><span class="ls-history-time">${escapeHtml(time(row.at))}</span>` +
      `<span class="ls-history-title">${escapeHtml(rowTitle(row, index === rows.length - 1))}</span>${badge}`,
  });
}

/** Fills `list` with day headings and rows; the row at `selected` is marked and scrolled into view. */
function renderTimeline(list: HTMLElement, rows: readonly HistoryRow[], selected: number): void {
  const items: HTMLElement[] = [];
  let day = "";
  rows.forEach((row, index) => {
    const label = dayLabel(row.at);
    if (label !== day) { items.push(renderElement("li", { class: "ls-history-day", role: "presentation", text: label })); day = label; }
    items.push(rowElement(row, index, rows, index === selected));
  });
  list.replaceChildren(...items);
  list.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
}

const SIGN: Record<DiffLine["kind"], string> = { same: " ", added: "+", removed: "−", gap: "" };
const CHANGE_LABEL = { added: "A", modified: "M", deleted: "D" } as const;

function renderFiles(list: HTMLElement, row: HistoryRow, selectedPath: string | undefined): void {
  list.replaceChildren(...row.changes.map((change) => renderElement("button", {
    class: `ls-history-file ls-history-file-${change.change}`, "data-path": change.path, "aria-pressed": String(change.path === selectedPath), title: change.path,
    html: `<span class="ls-history-file-mark">${CHANGE_LABEL[change.change]}</span><span class="ls-history-file-name">${escapeHtml(change.path)}</span>`,
  })));
}

function renderDiff(view: HTMLElement, lines: DiffLine[] | null): void {
  if (lines === null) { view.replaceChildren(renderElement("p", { class: "ls-history-note", text: "Binary file: no text to compare." })); return; }
  if (lines.length === 0) { view.replaceChildren(renderElement("p", { class: "ls-history-note", text: "Empty file." })); return; }
  view.replaceChildren(renderElement("pre", { class: "ls-history-diff" }, ...lines.map((line) => line.kind === "gap"
    ? renderElement("div", { class: "ls-history-line ls-history-line-gap", text: `${line.text} unchanged ${line.text === "1" ? "line" : "lines"}` })
    : renderElement("div", { class: `ls-history-line ls-history-line-${line.kind}`, html: `<span class="ls-history-sign">${SIGN[line.kind]}</span>${escapeHtml(line.text)}` }))));
}

const button = (label: string, name: Parameters<typeof renderIcon>[0], className = "ls-btn"): HTMLButtonElement =>
  renderElement("button", { class: className, title: label, html: `${renderIcon(name)}<span>${label}</span>` });

function buildLayout(root: HTMLElement) {
  const title = renderElement("h1", { class: "ls-history-heading" });
  const older = button("Older", "arrow-left", "ls-btn ls-btn-ghost");
  const newer = button("Newer", "arrow-right", "ls-btn ls-btn-ghost");
  const mark = button("Mark version", "tag");
  const compare = button("Compare versions", "git-compare");
  const timeline = renderElement("ol", { class: "ls-history-timeline", role: "listbox", tabindex: "0", "aria-label": "History" });
  const entryTitle = renderElement("h2", { class: "ls-history-entry-title" });
  const entryWhen = renderElement("p", { class: "ls-history-entry-when" });
  const restore = button("Restore this point", "refresh", "ls-btn ls-btn-primary");
  const files = renderElement("div", { class: "ls-history-files" });
  const diff = renderElement("div", { class: "ls-history-diff-view" });
  root.replaceChildren(renderElement("div", { class: "ls-history" },
    renderElement("header", { class: "ls-history-bar" }, renderElement("span", { class: "ls-history-icon", html: renderIcon("history") }), title,
      renderElement("span", { class: "ls-history-spacer" }), older, newer, mark, compare),
    renderElement("div", { class: "ls-history-body" }, timeline,
      renderElement("section", { class: "ls-history-detail" },
        renderElement("div", { class: "ls-history-entry" }, renderElement("div", {}, entryTitle, entryWhen), restore), files, diff))));
  return { title, older, newer, mark, compare, timeline, entryTitle, entryWhen, restore, files, diff };
}

export function mountProjectHistory(root: HTMLElement, transport: HistoryTransport): void {
  const ui = buildLayout(root);
  let rows: HistoryRow[] = [];
  let selected = 0;
  let path: string | undefined;

  function requestDiff(): void {
    const row = rows[selected];
    if (row && path) { transport.post({ type: "diff", id: row.id, path }); } else { ui.diff.replaceChildren(); }
  }

  function select(index: number, keepPath = false): void {
    if (rows.length === 0) { return; }
    selected = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[selected]!;
    if (!keepPath || !row.changes.some((change) => change.path === path)) { path = row.changes[0]?.path; }
    renderTimeline(ui.timeline, rows, selected);
    ui.entryTitle.textContent = rowTitle(row, selected === rows.length - 1);
    ui.entryWhen.textContent = `${new Date(row.at).toLocaleString()} · ${row.changes.length} ${row.changes.length === 1 ? "file" : "files"} changed`;
    ui.restore.disabled = selected === 0;
    ui.newer.disabled = selected === 0;
    ui.older.disabled = selected === rows.length - 1;
    renderFiles(ui.files, row, path);
    requestDiff();
  }

  ui.older.addEventListener("click", () => select(selected + 1));
  ui.newer.addEventListener("click", () => select(selected - 1));
  ui.mark.addEventListener("click", () => transport.post({ type: "markVersion" }));
  ui.compare.addEventListener("click", () => transport.post({ type: "compareVersions" }));
  ui.restore.addEventListener("click", () => { const row = rows[selected]; if (row) { transport.post({ type: "restore", id: row.id }); } });
  ui.timeline.addEventListener("click", (event) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset["index"];
    if (index !== undefined) { select(Number(index)); }
  });
  ui.timeline.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -rows.length, End: rows.length }[event.key];
    if (step === undefined) { return; }
    event.preventDefault();
    select(selected + step);
  });
  ui.files.addEventListener("click", (event) => {
    const picked = (event.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset["path"];
    if (!picked) { return; }
    path = picked;
    renderFiles(ui.files, rows[selected]!, path);
    requestDiff();
  });
  transport.subscribe((message: HostToHistory) => {
    if (message.type === "history") {
      const id = rows[selected]?.id;
      const wasCurrent = selected === 0;
      rows = message.rows;
      ui.title.textContent = message.project;
      // A new entry keeps the view on the current state, unless the user was looking at an older entry.
      const kept = rows.findIndex((row) => row.id === id);
      select(wasCurrent || kept < 0 ? 0 : kept, true);
      if (rows.length === 0) { ui.entryTitle.textContent = "No history yet. Save a file to start it."; ui.restore.disabled = true; }
    }
    if (message.type === "diff" && message.id === rows[selected]?.id && message.path === path) { renderDiff(ui.diff, message.lines); }
    if (message.type === "busy") { root.classList.toggle("ls-history-busy", message.busy); ui.restore.disabled = message.busy || selected === 0; }
  });
  transport.post({ type: "ready" });
  ui.timeline.focus();
}
