/** Finds the reference under the pointer in plain text (scans, papers without link annotations) and describes it as a hover target. */
import { findReferenceAtOffset, type InTextReference } from "../../text/index.js";
import type { HoverAnchor } from "./hoverAnchor.js";
import { deriveCharRangeRect, TEXT_RUN_SELECTOR, deriveUnionRect, deriveVisualLine, type VisualLine } from "./textGeometry.js";

// OCR text is one run per word, and a reader points at the word, not at a character of it: on a run this short the
// whole box answers for the one reference it belongs to ("[1])," — the pointer may sit on the comma).
const WHOLE_RUN_MAX_CHARS = 14;

/**
 * @returns the text run the event is on, or null when it is not on a non-empty run of a text layer.
 */
export function runUnderPointer(e: MouseEvent): HTMLElement | null {
  const run = (e.target as Element).closest?.<HTMLElement>(TEXT_RUN_SELECTOR);
  if (!run || !run.closest(".textLayer") || !(run.textContent ?? "").trim()) { return null; }
  return run;
}

export class TextAnchors {
  /** Lines are rebuilt from geometry; pointer movement inside one run must not pay for that again. Spans are replaced when a page re-renders, which drops their entries. */
  private readonly lines = new WeakMap<HTMLElement, VisualLine>();

  targetAt(run: HTMLElement, clientX: number, clientY: number): HoverAnchor | null {
    const layer = run.closest<HTMLElement>(".textLayer");
    if (!layer) { return null; }
    const line = this.lineOf(layer, run);
    const index = line.spans.indexOf(run);
    if (index < 0 || line.refs.length === 0) { return null; }
    const runStart = line.joined.starts[index] ?? 0;
    const runEnd = runStart + (line.parts[index]?.text.length ?? 0);

    let ref: InTextReference | null = null;
    const caret = document.caretRangeFromPoint(clientX, clientY);
    if (caret && run.contains(caret.startContainer)) {
      // Characters of this run that precede the pointer (the run may hold nested find-highlight spans).
      const before = document.createRange();
      before.setStart(run, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      ref = findReferenceAtOffset(line.refs, runStart + before.toString().length);
    }
    if (!ref && runEnd - runStart <= WHOLE_RUN_MAX_CHARS) {
      const touching = line.refs.filter((r) => r.start < runEnd && r.end > runStart);
      if (touching.length === 1) { ref = touching[0]!; }
    }
    if (!ref) { return null; }

    const found = ref;
    const pieces: Array<{ span: HTMLElement; from: number; to: number }> = [];
    line.spans.forEach((span, i) => {
      const start = line.joined.starts[i] ?? 0;
      const length = line.parts[i]?.text.length ?? 0;
      if (start < found.end && start + length > found.start) {
        pieces.push({ span, from: Math.max(0, found.start - start), to: Math.min(length, found.end - start) });
      }
    });
    if (pieces.length === 0) { return null; }
    return { group: pieces.map((p) => p.span), ref: found, rect: () => deriveUnionRect(pieces.map((p) => deriveCharRangeRect(p.span, p.from, p.to))) };
  }

  private lineOf(layer: HTMLElement, run: HTMLElement): VisualLine {
    const cached = this.lines.get(run);
    if (cached && cached.spans.every((s) => s.isConnected)) { return cached; }
    const line = deriveVisualLine(layer, run);
    // Kept for this run only: membership is judged from the probed run's own height, so it is not symmetric.
    this.lines.set(run, line);
    return line;
  }
}
