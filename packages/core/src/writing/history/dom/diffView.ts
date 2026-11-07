// The line diff of two texts as the history page draws it: one row per line with its sign, and a gap row for an unchanged run.
import { renderElement } from "../../../ui/dom/index.js";
import { escapeHtml } from "../../../ui/index.js";
import type { DiffLine } from "../historyEntries.js";

const SIGN: Record<DiffLine["kind"], string> = { same: " ", added: "+", removed: "−", gap: "" };

/** The lines as a pre.ls-history-diff with one ls-history-line-{kind} row per line. */
export function renderDiffLines(lines: readonly DiffLine[]): HTMLElement {
  return renderElement("pre", { class: "ls-history-diff" }, ...lines.map((line) => line.kind === "gap"
    ? renderElement("div", { class: "ls-history-line ls-history-line-gap", text: `${line.text} unchanged ${line.text === "1" ? "line" : "lines"}` })
    : renderElement("div", { class: `ls-history-line ls-history-line-${line.kind}`, html: `<span class="ls-history-sign">${SIGN[line.kind]}</span>${escapeHtml(line.text)}` })));
}
