// Mounts the project history page: a timeline to step through, the selected entry's changes and the restore action.
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/icons/index.js";
import type { HistoryRow, HistoryTransport, HostToHistory } from "../protocol.js";
import { escapeHtml } from "../../../ui/index.js";
import type { DiffLine } from "../historyEntries.js";
import { renderDiffLines } from "./diffView.js";
import { formatClockTime, formatDayLabel, formatShortDateTime } from "../../../time/index.js";

/** What the row says it did: a version name, a restore or the files it touched. */
function rowTitle(row: HistoryRow, oldest: boolean): string {
  if (row.kind === "version") { return `Version “${row.label ?? ""}”`; }
  if (row.kind === "restore") { return `Restored to ${row.label ? formatShortDateTime(row.label) : "an earlier point"}`; }
  if (oldest) { return "First recorded state"; }
  const names = row.changes.map((change) => change.path.split("/").pop() ?? change.path);
  if (names.length === 0) { return "No file changes"; }
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function rowElement(row: HistoryRow, index: number, rows: readonly HistoryRow[], selected: boolean): HTMLElement {
  const badge = index === 0 ? `<span class="ls-history-badge">Now</span>` : "";
  return renderElement("li", {
    class: `ls-history-row ls-history-${row.kind}${index === 0 ? " ls-history-current" : ""}`, role: "option", "aria-selected": String(selected), "data-index": index, tabindex: "-1",
    html: `<span class="ls-history-dot" aria-hidden="true"></span><span class="ls-history-time">${escapeHtml(formatClockTime(row.at))}</span>` +
      `<span class="ls-history-title">${escapeHtml(rowTitle(row, index === rows.length - 1))}</span>${badge}`,
  });
}

/** Fills `list` with day headings and rows; the row at `selected` is marked and scrolled into view. */
function renderTimeline(list: HTMLElement, rows: readonly HistoryRow[], selected: number): void {
  const items: HTMLElement[] = [];
  let day = "";
  rows.forEach((row, index) => {
    const label = formatDayLabel(row.at);
    if (label !== day) { items.push(renderElement("li", { class: "ls-history-day", role: "presentation", text: label })); day = label; }
    items.push(rowElement(row, index, rows, index === selected));
  });
  list.replaceChildren(...items);
  list.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
}

const CHANGE_LABEL = { added: "Added", modified: "Modified", deleted: "Deleted" } as const;

/** The entry's files, one per line: the name, its folder dimmed, and what happened to it; the picked one shows its diff. */
function renderFiles(list: HTMLElement, row: HistoryRow, selectedPath: string | undefined): void {
  list.replaceChildren(...row.changes.map((change) => {
    const slash = change.path.lastIndexOf("/");
    const folder = slash < 0 ? "" : `<span class="ls-history-file-dir">${escapeHtml(change.path.slice(0, slash + 1))}</span>`;
    return renderElement("button", {
      class: `ls-history-file ls-history-file-${change.change}`, "data-path": change.path, "aria-pressed": String(change.path === selectedPath), title: change.path,
      html: `<span class="ls-history-file-name">${folder}<span class="ls-history-file-base">${escapeHtml(change.path.slice(slash + 1))}</span></span>` +
        `<span class="ls-history-file-mark">${CHANGE_LABEL[change.change]}</span>`,
    });
  }));
}

function renderDiff(view: HTMLElement, lines: DiffLine[] | null): void {
  if (lines === null) { view.replaceChildren(renderElement("p", { class: "ls-history-note", text: "Binary file: no text to compare." })); return; }
  if (lines.length === 0) { view.replaceChildren(renderElement("p", { class: "ls-history-note", text: "Empty file." })); return; }
  view.replaceChildren(renderDiffLines(lines));
}

const button = (label: string, name: Parameters<typeof renderIcon>[0], className = "ls-btn"): HTMLButtonElement =>
  renderElement("button", { class: className, title: label, "aria-label": label, html: `${renderIcon(name)}<span class="ls-history-btn-label">${label}</span>` });

/** An arrow that steps through the timeline; newest is at the top, so Newer goes up. */
const stepButton = (label: string, name: "chevron-up" | "chevron-down"): HTMLButtonElement =>
  renderElement("button", { class: "ls-icon-btn ls-history-step", title: label, "aria-label": label, html: renderIcon(name) });

function buildLayout(root: HTMLElement) {
  const title = renderElement("h1", { class: "ls-history-heading" });
  const newer = stepButton("Newer change", "chevron-up");
  const older = stepButton("Older change", "chevron-down");
  const mark = button("Save version", "tag");
  const compare = button("Compare", "git-compare");
  const timeline = renderElement("ol", { class: "ls-history-timeline", role: "listbox", tabindex: "0", "aria-label": "History" });
  const entryTitle = renderElement("h2", { class: "ls-history-entry-title" });
  const entryWhen = renderElement("p", { class: "ls-history-entry-when" });
  const restore = button("Restore this version", "refresh", "ls-btn ls-btn-primary");
  const now = renderElement("p", { class: "ls-history-now", text: "This is the project as it is now." });
  const filesHead = renderElement("h3", { class: "ls-history-section" });
  const files = renderElement("div", { class: "ls-history-files" });
  const diffHead = renderElement("div", { class: "ls-history-diff-head" });
  const diff = renderElement("div", { class: "ls-history-diff-view" });
  root.replaceChildren(renderElement("div", { class: "ls-history" },
    renderElement("header", { class: "ls-history-bar" },
      renderElement("span", { class: "ls-history-icon", html: renderIcon("history") }),
      renderElement("div", { class: "ls-history-titles" }, renderElement("span", { class: "ls-history-kicker", text: "Project history" }), title),
      renderElement("span", { class: "ls-history-steps" }, newer, older), mark, compare),
    renderElement("div", { class: "ls-history-body" },
      renderElement("div", { class: "ls-history-side" },
        renderElement("p", { class: "ls-history-intro", text: "Every save is recorded here. Pick a moment to see what changed, or bring the project back to it." }),
        timeline),
      renderElement("section", { class: "ls-history-detail" },
        renderElement("div", { class: "ls-history-entry" }, renderElement("div", { class: "ls-history-entry-text" }, entryTitle, entryWhen), restore, now),
        filesHead, files, diffHead, diff))));
  return { title, older, newer, mark, compare, timeline, entryTitle, entryWhen, restore, now, filesHead, files, diffHead, diff };
}

type HistoryUi = ReturnType<typeof buildLayout>;

/** Shows the entry at `selected` of `count` in the detail head and enables the buttons that can still move or restore. */
function renderEntry(ui: HistoryUi, row: HistoryRow, selected: number, count: number): void {
  ui.entryTitle.textContent = rowTitle(row, selected === count - 1);
  ui.entryWhen.textContent = new Date(row.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  ui.filesHead.textContent = row.changes.length === 0 ? "No files changed" : `${row.changes.length} ${row.changes.length === 1 ? "file" : "files"} changed`;
  // The newest entry is the project as it is: nothing to restore, so it says so instead of a disabled button.
  ui.restore.hidden = selected === 0;
  ui.now.hidden = selected !== 0;
  ui.restore.disabled = selected === 0;
  ui.newer.disabled = selected === 0;
  ui.older.disabled = selected === count - 1;
}

interface HistoryNavigation {
  select(index: number): void;
  /** Shows the diff of the file at `path` in the selected entry. */
  pick(path: string): void;
  selected(): number;
  row(): HistoryRow | undefined;
  count(): number;
}

/** Wires the toolbar buttons, the restore button, the file list and the timeline's clicks and arrow keys. */
function bindNavigation(ui: HistoryUi, transport: HistoryTransport, nav: HistoryNavigation): void {
  ui.older.addEventListener("click", () => nav.select(nav.selected() + 1));
  ui.newer.addEventListener("click", () => nav.select(nav.selected() - 1));
  ui.mark.addEventListener("click", () => transport.post({ type: "markVersion" }));
  ui.compare.addEventListener("click", () => transport.post({ type: "compareVersions" }));
  ui.restore.addEventListener("click", () => { const row = nav.row(); if (row) { transport.post({ type: "restore", id: row.id }); } });
  ui.timeline.addEventListener("click", (event) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset["index"];
    if (index !== undefined) { nav.select(Number(index)); }
  });
  ui.files.addEventListener("click", (event) => {
    const picked = (event.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset["path"];
    if (picked) { nav.pick(picked); }
  });
  ui.timeline.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -nav.count(), End: nav.count() }[event.key];
    if (step === undefined) { return; }
    event.preventDefault();
    nav.select(nav.selected() + step);
  });
}

export function mountProjectHistory(root: HTMLElement, transport: HistoryTransport): void {
  const ui = buildLayout(root);
  let rows: HistoryRow[] = [];
  let selected = 0;
  let path: string | undefined;

  function requestDiff(): void {
    const row = rows[selected];
    ui.diffHead.textContent = path ?? "";
    if (row && path) { transport.post({ type: "diff", id: row.id, path }); } else { ui.diff.replaceChildren(); }
  }

  function select(index: number, keepPath = false): void {
    if (rows.length === 0) { return; }
    selected = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[selected]!;
    if (!keepPath || !row.changes.some((change) => change.path === path)) { path = row.changes[0]?.path; }
    renderTimeline(ui.timeline, rows, selected);
    renderEntry(ui, row, selected, rows.length);
    renderFiles(ui.files, row, path);
    requestDiff();
  }

  function pick(picked: string): void {
    path = picked;
    renderFiles(ui.files, rows[selected]!, path);
    requestDiff();
  }

  bindNavigation(ui, transport, {
    select, pick, selected: () => selected, row: () => rows[selected], count: () => rows.length,
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
      if (rows.length === 0) { ui.entryTitle.textContent = "No history yet. Save a file to start it."; ui.restore.disabled = true; ui.restore.hidden = true; ui.now.hidden = true; }
    }
    if (message.type === "diff" && message.id === rows[selected]?.id && message.path === path) { renderDiff(ui.diff, message.lines); }
    if (message.type === "busy") { root.classList.toggle("ls-history-busy", message.busy); ui.restore.disabled = message.busy || selected === 0; }
  });
  transport.post({ type: "ready" });
  ui.timeline.focus();
}
