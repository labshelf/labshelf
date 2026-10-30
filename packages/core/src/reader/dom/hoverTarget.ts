// Finds what the pointer hovers (text references and link destinations) and previews a link destination.
import { deriveFloatRegion, type PdfRegion } from "../geometry.js";
import { classifyDestName, classifyLinkText, type DestTarget } from "../destTarget.js";
import { deriveStatementRegion, findFloatCaptionNear, findStatementStart } from "../destRegion.js";
import type { FloatKind } from "../inTextReferences.js";
import { findReferenceAtOffset, type InTextReference, findInTextReferences, joinLineParts, type JoinedLine, type LinePart } from "../inTextReferences.js";
import type { HoverAnchor, PdfDestination, PopupContent } from "./hoverPreview.js";
import { deriveDestPoint } from "../index.js";
import type { CitationResolver, PageTextCache } from "./textLayer.js";
import type { PreviewCitations } from "./citations.js";
import type { ReaderContext } from "./readerSession.js";
import type { DestPreview } from "./destPreview.js";
import { renderElement } from "../../ui/dom/index.js";

/** Finds the reference under the pointer in plain text (scans, papers without link annotations) and describes it as a hover target. */

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

/** Measures pdf.js text runs: the visual line a run belongs to and the screen boxes of character ranges. */

const TEXT_RUN_SELECTOR = 'span[role="presentation"]';

interface VisualLine {
  spans: HTMLElement[];
  parts: LinePart[];
  joined: JoinedLine;
  refs: InTextReference[];
}

function deriveUnionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
}

/** Screen box of characters [from, to) of a run, which may hold nested find-highlight spans. */
function deriveCharRangeRect(run: HTMLElement, from: number, to: number): DOMRect {
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
function deriveVisualLine(layer: HTMLElement, run: HTMLElement): VisualLine {
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

/** Builds hover targets for PDF link annotations: finds the link under the pointer and prepares the popup for its destination. */

const LINK_SELECTOR = "section.linkAnnotation[data-internal-link]";

/**
 * @returns the internal link annotation the event is on, or null.
 */
export function findDestAnchor(e: MouseEvent): HTMLElement | null {
  return (e.target as Element).closest?.<HTMLElement>(LINK_SELECTOR) ?? null;
}

export function createDestHoverAnchor(link: HTMLElement): HoverAnchor {
  return { group: [link], ref: null, rect: () => link.getBoundingClientRect() };
}

export const FLOAT_TITLES: Record<FloatKind, string> = { figure: "Figure", table: "Table", equation: "Equation" };

// Link text is judged by the words that end at the link ("Theorem", "Figure"), so only the tail of the line matters.
const LINK_TEXT_CHARS = 60;

// A run may carry on past the link ("Theorem 1.2 (Szemerédi"): keep only the characters that end inside it.
function cutRunAt(run: HTMLElement, text: string, right: number): string {
  let kept = "";
  for (let i = 0; i < text.length; i++) {
    if (deriveCharRangeRect(run, i, i + 1).right <= right) { kept += text[i]; }
  }
  return kept;
}

/**
 * @returns the text on the link's line that ends at the link, or an empty string when the page has no text layer.
 */
function readTextEndingAt(link: HTMLElement): string {
  const layer = link.closest<HTMLElement>(".page")?.querySelector<HTMLElement>(".textLayer");
  if (!layer) { return ""; }
  const box = link.getBoundingClientRect();
  const centre = box.top + box.height / 2;
  const reach = box.height * 0.6;
  const runs: Array<{ left: number; text: string }> = [];
  for (const el of layer.querySelectorAll<HTMLElement>(TEXT_RUN_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top + r.height / 2 - centre) > reach || r.left >= box.right - 1) { continue; }
    const text = el.textContent ?? "";
    runs.push({ left: r.left, text: r.right <= box.right + 1 ? text : cutRunAt(el, text, box.right + 1) });
  }
  runs.sort((a, b) => a.left - b.left);
  return runs.map((r) => r.text).join(" ").slice(-LINK_TEXT_CHARS);
}

export class DestContent {
  constructor(
    private readonly ctx: ReaderContext,
    private readonly resolver: CitationResolver,
    private readonly pages: PageTextCache,
    private readonly preview: DestPreview,
    private readonly citations: PreviewCitations,
  ) {}

  async prepare(link: HTMLElement, isCurrent: () => boolean): Promise<PopupContent | null> {
    const pageNumber = Number(link.closest<HTMLElement>(".page")?.dataset["pageNumber"]);
    const id = link.dataset["annotationId"];
    if (!pageNumber || !id) { return null; }
    const dest = (await this.citations.annotations.find(pageNumber, id))?.dest;
    if (!dest) { return null; }
    const card = await this.citations.linkCard(link);
    if (card) { return card; }
    const doc = this.ctx.pdfDocument;
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) { return null; }
    const ref = explicit[0] as unknown;
    const targetPage = ref && typeof ref === "object"
      ? (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1
      : typeof ref === "number" ? ref + 1 : 0;
    if (!targetPage || !isCurrent()) { return null; }
    const point = deriveDestPoint(explicit) ?? { x: null, y: null, kind: "Fit" };
    const jump = (): void => { void this.ctx.linkService.goToDestination(dest as PdfDestination); };

    if (point.y !== null && await this.resolver.isInReferences(targetPage, point.y, point.x)) {
      const text = await this.resolver.entryAt(targetPage, point.y, point.x);
      if (text) { return renderTextContent([text], jump); }
      // No reliable entry boundaries: a picture of the destination is never wrong, extracted text could be.
    }
    if (!isCurrent()) { return null; }
    const target = (typeof dest === "string" ? classifyDestName(dest) : null)
      ?? classifyLinkText(readTextEndingAt(link))
      ?? (point.y !== null ? await this.findStatementAt(targetPage, { x: point.x, y: point.y }) : null);
    if (!isCurrent()) { return null; }
    if (target && point.y !== null) {
      const cropped = await this.prepareCrop(target, targetPage, { x: point.x, y: point.y }, jump, isCurrent);
      if (cropped) { return cropped; }
      if (!isCurrent()) { return null; }
    }
    const canvas = await this.preview.render(targetPage, point.x, point.y);
    return canvas ? { title: `Page ${targetPage}`, body: canvas, copyText: null, jump } : null;
  }

  /**
   * Shared-counter names ("subsection.1.2") hide a theorem: a statement heading right under the destination reveals it.
   * @returns a statement target when one is found, else null (a real subsection link keeps the band).
   */
  private async findStatementAt(targetPage: number, dest: { x: number | null; y: number }): Promise<DestTarget | null> {
    try {
      const { lines, columnSplit, width, height } = await this.pages.get(targetPage);
      return findStatementStart(lines, { width, height, columnSplit }, dest) === null ? null : { kind: "statement" };
    } catch {
      return null;
    }
  }

  /** @returns the popup of the statement or float the destination points at, or null when it cannot be located. */
  private async prepareCrop(
    target: DestTarget,
    targetPage: number,
    dest: { x: number | null; y: number },
    jump: () => void,
    isCurrent: () => boolean,
  ): Promise<PopupContent | null> {
    try {
      const { lines, columnSplit, width, height } = await this.pages.get(targetPage);
      if (!isCurrent()) { return null; }
      const layout = { width, height, columnSplit };
      let region: PdfRegion | null;
      let title = `Page ${targetPage}`;
      if (target.kind === "statement") {
        region = deriveStatementRegion(lines, layout, dest);
      } else {
        const hit = findFloatCaptionNear(lines, layout, target, dest);
        region = hit ? deriveFloatRegion(lines, hit, width, height, columnSplit) : null;
        // The caption's printed label: LLNCS names printed Figure 1 "figure.1.1".
        if (hit) { title = `${FLOAT_TITLES[hit.kind]} ${hit.label.toUpperCase()} · Page ${targetPage}`; }
      }
      if (!region) { return null; }
      const canvas = await this.preview.renderRegion(targetPage, region);
      if (!canvas || !isCurrent()) { return null; }
      return { title, body: canvas, copyText: null, jump };
    } catch {
      // A page whose text cannot be extracted keeps the band.
      return null;
    }
  }
}

// Fills a popup with plain reference text.
export function renderTextContent(texts: string[], jump: () => void): PopupContent {
  return { title: "Reference", body: renderElement("div", { class: "rd-hover-text" }, ...texts.map((t) => renderElement("p", {}, t))), copyText: texts.join("\n\n"), jump };
}
