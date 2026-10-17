// Mounts the project history page: a timeline to step through, the selected entry's changes and the restore action.
import { el } from "../../../ui/dom/dom.js";
import { icon } from "../../../ui/icons/index.js";
import type { HistoryRow, HistoryTransport, HostToHistory } from "../protocol/index.js";
import { renderDiff, renderFiles } from "./historyDetail.js";
import { renderTimeline, rowTitle } from "./historyTimeline.js";

const button = (label: string, name: Parameters<typeof icon>[0], className = "ls-btn"): HTMLButtonElement =>
  el("button", { class: className, title: label, html: `${icon(name)}<span>${label}</span>` });

function buildLayout(root: HTMLElement) {
  const title = el("h1", { class: "ls-history-heading" });
  const older = button("Older", "arrow-left", "ls-btn ls-btn-ghost");
  const newer = button("Newer", "arrow-right", "ls-btn ls-btn-ghost");
  const mark = button("Mark version", "tag");
  const compare = button("Compare versions", "git-compare");
  const timeline = el("ol", { class: "ls-history-timeline", role: "listbox", tabindex: "0", "aria-label": "History" });
  const entryTitle = el("h2", { class: "ls-history-entry-title" });
  const entryWhen = el("p", { class: "ls-history-entry-when" });
  const restore = button("Restore this point", "refresh", "ls-btn ls-btn-primary");
  const files = el("div", { class: "ls-history-files" });
  const diff = el("div", { class: "ls-history-diff-view" });
  root.replaceChildren(el("div", { class: "ls-history" },
    el("header", { class: "ls-history-bar" }, el("span", { class: "ls-history-icon", html: icon("history") }), title,
      el("span", { class: "ls-history-spacer" }), older, newer, mark, compare),
    el("div", { class: "ls-history-body" }, timeline,
      el("section", { class: "ls-history-detail" },
        el("div", { class: "ls-history-entry" }, el("div", {}, entryTitle, entryWhen), restore), files, diff))));
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
