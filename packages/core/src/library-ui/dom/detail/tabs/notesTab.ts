/**
 * Renders the Notes tab: the paper's own note, saved as you type, with Insert highlights and Copy note, and the notes made
 * in the PDF below it. Read-only when the host cannot write notes.
 */
import { escapeHtml, icon } from "../../../../ui/index.js";
import { iconBtn, muted, section } from "../detailMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";
import { annotationCard } from "./annotationsTab.js";

function editor(pane: PaneState, v: PaperView): string {
  const text = pane.notes.text(v.p);
  const hasHighlights = v.details?.annotations.some((a) => a.type === "highlight") ?? false;
  return `<textarea class="note-input" spellcheck="true" aria-label="Your note" placeholder="Your notes on this paper: the key idea, how it relates to your work, what to follow up…">${escapeHtml(text)}</textarea>` +
    `<div class="tab-toolbar"><span class="note-state muted-text">${text.trim() ? "Saved with the paper · syncs with it" : "Saved automatically with the paper"}</span><span class="tb-spacer"></span>` +
      (hasHighlights ? `<button class="ls-btn" type="button" data-action="insertHighlights" title="Append your highlights as quotes">${icon("highlighter")}<span>Insert highlights</span></button>` : "") +
      iconBtn("copyNote", "copy", "Copy note") +
    `</div>`;
}

function readOnly(v: PaperView): string {
  const note = v.p.note?.trim();
  return note ? `<div class="detail-note">${escapeHtml(note)}</div>${`<div class="tab-toolbar"><span class="tb-spacer"></span>${iconBtn("copyNote", "copy", "Copy note")}</div>`}` : muted("No note.");
}

export function notesTabHtml(pane: PaneState, v: PaperView): string {
  const pdfNotes = v.details?.annotations.filter((a) => a.type !== "highlight") ?? [];
  return `<div class="notes-tab">${pane.ctx.caps.editNote ? editor(pane, v) : readOnly(v)}</div>` +
    (pdfNotes.length ? section("pdfnotes", "Notes in the PDF", pdfNotes.map(annotationCard).join(""), pane.collapsed, { count: pdfNotes.length }) : "");
}
