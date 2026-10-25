/** Measures pdf.js text runs: the visual line a run belongs to and the screen boxes of character ranges. */
import { findInTextReferences, joinLineParts, type InTextReference, type JoinedLine, type LinePart } from "../../text/index.js";

export const TEXT_RUN_SELECTOR = 'span[role="presentation"]';

export interface VisualLine {
  spans: HTMLElement[];
  parts: LinePart[];
  joined: JoinedLine;
  refs: InTextReference[];
}

export function deriveUnionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
}

/** Screen box of characters [from, to) of a run, which may hold nested find-highlight spans. */
export function deriveCharRangeRect(run: HTMLElement, from: number, to: number): DOMRect {
  const range = document.createRange();
  const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && from <= seen + length) { range.setStart(node, Math.max(0, from - seen)); started = true; }
    if (started && to <= seen + length) { range.setEnd(node, Math.max(0, to - seen)); break; }
    seen += length;
  }
  const rect = started && !range.collapsed ? range.getBoundingClientRect() : null;
  return rect && rect.width > 0 ? rect : run.getBoundingClientRect();
}

/** A run of several characters that is taller than wide is set sideways. */
function isSideways(text: string, rect: DOMRect): boolean {
  return text.trim().length > 3 && rect.height > rect.width * 1.5;
}

/**
 * The text runs that share the hovered run's visual line, left to right. pdf.js positions every run absolutely, so the
 * line is recovered from geometry rather than from DOM order.
 */
export function deriveVisualLine(layer: HTMLElement, run: HTMLElement): VisualLine {
  const ref = run.getBoundingClientRect();
  if (isSideways(run.textContent ?? "", ref)) {
    // Its box spans the page's height: every run of the page would count as sharing its "line".
    const parts: LinePart[] = [{ text: run.textContent ?? "", left: ref.left, right: ref.right, height: ref.height }];
    return { spans: [run], parts, joined: joinLineParts(parts), refs: [] };
  }
  const centre = ref.top + ref.height / 2;
  const tolerance = Math.max(ref.height, 4) * 0.6;
  const spans: HTMLElement[] = [];
  const rects = new Map<HTMLElement, DOMRect>();
  for (const el of layer.querySelectorAll<HTMLElement>(TEXT_RUN_SELECTOR)) {
    const text = (el.textContent ?? "").trim();
    if (!text) { continue; }
    const r = el.getBoundingClientRect();
    // A publisher's stamp up the margin would otherwise join whichever line crosses its middle.
    if (el !== run && isSideways(text, r)) { continue; }
    if (Math.abs(r.top + r.height / 2 - centre) <= tolerance) { spans.push(el); rects.set(el, r); }
  }
  spans.sort((a, b) => rects.get(a)!.left - rects.get(b)!.left);
  const parts = spans.map((el): LinePart => {
    const r = rects.get(el)!;
    return { text: el.textContent ?? "", left: r.left, right: r.right, height: r.height };
  });
  const joined = joinLineParts(parts);
  return { spans, parts, joined, refs: findInTextReferences(joined.text) };
}
