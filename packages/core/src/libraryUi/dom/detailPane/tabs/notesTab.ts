/**
 * Renders the Notes tab: the paper's own note, saved as you type, with Insert highlights and Copy note, and the notes made
 * in the PDF below it.
 */
import { escapeHtml, icon } from "../../../../ui/index.js";
import { renderIconButton, renderMuted, renderSection } from "../detailPaneMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";
import { renderAnnotationCard } from "./annotationsTab.js";

function editor(pane: PaneState, v: PaperView): string {
  const text = pane.notes.text(v.p);
  const hasHighlights = v.details?.annotations.some((a) => a.type === "highlight") ?? false;
  return `<textarea class="note-input" spellcheck="true" aria-label="Your note" placeholder="Your notes on this paper: the key idea, how it relates to your work, what to follow up…">${escapeHtml(text)}</textarea>` +
    `<div class="tab-toolbar"><span class="note-state muted-text">${text.trim() ? "Saved with the paper · syncs with it" : "Saved automatically with the paper"}</span><span class="tb-spacer"></span>` +
      (hasHighlights ? `<button class="ls-btn" type="button" data-action="insertHighlights" title="Append your highlights as quotes">${icon("highlighter")}<span>Insert highlights</span></button>` : "") +
      renderIconButton("copyNote", "copy", "Copy note") +
    `</div>`;
}

export function renderNotesTabHtml(pane: PaneState, v: PaperView): string {
  const pdfNotes = v.details?.annotations.filter((a) => a.type !== "highlight") ?? [];
  if (pane.ctx.readOnly && pdfNotes.length === 0) return renderMuted("No notes.");
  return (pane.ctx.readOnly ? "" : `<div class="notes-tab">${editor(pane, v)}</div>`) +
    (pdfNotes.length ? renderSection("pdfnotes", "Notes in the PDF", pdfNotes.map(renderAnnotationCard).join(""), pane.collapsed, { count: pdfNotes.length }) : "");
}
