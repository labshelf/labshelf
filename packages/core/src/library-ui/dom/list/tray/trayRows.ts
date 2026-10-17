// Builds the DOM of one file-tray row: type, name, fact and the empty slot for hover actions.
import { el } from "../../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import type { TrayEntry } from "./fileFacts.js";

const cell = (cls: string, html: string): string => `<div class="${cls}" role="gridcell">${html}</div>`;

function row(extra: string, title: string, html: string, attrs: Record<string, string> = {}): HTMLElement {
  return el("div", { class: `file-row${extra}`, role: "row", "aria-level": "2", tabindex: "-1", title, html, ...attrs });
}

/** A row for a note, file or subfolder; `data-kind` and `data-name` say which one it is. */
export function buildTrayRow(e: TrayEntry, onActivate: () => void): HTMLElement {
  const type = e.kind === "folder" ? icon("chevron-right") : escapeHtml(e.type);
  const label = e.fact?.label ? `<span class="file-fact-label">${escapeHtml(e.fact.label)}</span> ` : "";
  // The paper.pdf fact is a button the short-note editor fills in.
  const fact = e.fact && e.kind !== "pdf" ? label + escapeHtml(e.fact.text) : "";
  const r = row("", e.title,
    cell(`file-type tone-${e.tone}`, type) + cell("file-name", escapeHtml(e.name)) + cell("file-fact", fact) + cell("file-actions", ""),
    { "data-kind": e.kind, "data-name": e.name });
  r.addEventListener("click", onActivate);
  return r;
}

/** The single row shown while the listing loads. */
export function buildLoadingRow(): HTMLElement {
  return row(" file-state", "", cell("file-type", `<span class="spin">${icon("loader")}</span>`) + cell("file-message", "Loading files…"));
}

/** The single row shown when the listing could not be read. */
export function buildFailedRow(message: string): HTMLElement {
  return row(" file-state failed", message, cell("file-type", icon("warning")) + cell("file-message", escapeHtml(message)));
}
