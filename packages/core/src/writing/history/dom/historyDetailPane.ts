// Renders the selected history entry: its heading, the files it changed and the line diff of one of them.
import { escapeHtml } from "../../../ui/escapeHtml.js";
import { el } from "../../../ui/dom/dom.js";
import type { DiffLine } from "../lineDiff.js";
import type { HistoryRow } from "../protocol/index.js";

const SIGN: Record<DiffLine["kind"], string> = { same: " ", added: "+", removed: "−", gap: "" };
const CHANGE_LABEL = { added: "A", modified: "M", deleted: "D" } as const;

export function renderFiles(list: HTMLElement, row: HistoryRow, selectedPath: string | undefined): void {
  list.replaceChildren(...row.changes.map((change) => el("button", {
    class: `ls-history-file ls-history-file-${change.change}`, "data-path": change.path, "aria-pressed": String(change.path === selectedPath), title: change.path,
    html: `<span class="ls-history-file-mark">${CHANGE_LABEL[change.change]}</span><span class="ls-history-file-name">${escapeHtml(change.path)}</span>`,
  })));
}

export function renderDiff(view: HTMLElement, lines: DiffLine[] | null): void {
  if (lines === null) { view.replaceChildren(el("p", { class: "ls-history-note", text: "Binary file: no text to compare." })); return; }
  if (lines.length === 0) { view.replaceChildren(el("p", { class: "ls-history-note", text: "Empty file." })); return; }
  view.replaceChildren(el("pre", { class: "ls-history-diff" }, ...lines.map((line) => line.kind === "gap"
    ? el("div", { class: "ls-history-line ls-history-line-gap", text: `${line.text} unchanged ${line.text === "1" ? "line" : "lines"}` })
    : el("div", { class: `ls-history-line ls-history-line-${line.kind}`, html: `<span class="ls-history-sign">${SIGN[line.kind]}</span>${escapeHtml(line.text)}` }))));
}
