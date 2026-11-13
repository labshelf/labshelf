// The page-side helpers of the text-box notes: the obstacles to place around, the draft rectangle, the minimum size and the caret.
import { type PageRect } from "../textBoxPlacement.js";
import { renderElement } from "../../ui/dom/index.js";
import { derivePageFrame, deriveBoxInPage, type PageFrame } from "./pageHighlights.js";

export const LAYER_CLASS = "rd-note-layer";
const DRAFT_CLASS = "rd-box-draft";
/** The smallest box, in ems of its own font: about six characters wide and one line (with its padding) tall. */
const MIN_EM = { w: 6, h: 1.65 };
/** The font size assumed when the box has none computed (no layout). */
const FALLBACK_EM_PX = 12;

/** Text and other boxes of a page in page fractions, the obstacles `fitEmptyBox` and `snapBox` place around. */
export function collectPageRects(page: HTMLElement, exceptId?: string): PageRect[] {
  const frame = derivePageFrame(page);
  if (!frame) { return []; }
  const rects: PageRect[] = [];
  const add = (r: DOMRect): void => {
    const b = deriveBoxInPage(r, frame);
    if (b) { rects.push({ x: b.x, y: b.y, w: b.width, h: b.height }); }
  };
  for (const span of page.querySelectorAll<HTMLElement>(".textLayer span")) {
    if (span.childElementCount === 0 && span.textContent?.trim()) { add(span.getBoundingClientRect()); }
  }
  for (const box of page.querySelectorAll<HTMLElement>(`.${LAYER_CLASS} .rd-note-box`)) {
    if (box.dataset["noteId"] !== exceptId) { add(box.getBoundingClientRect()); }
  }
  return rects;
}

/** Shows or moves the dashed draft rectangle over a page; null removes it. */
export function showDraft(page: HTMLElement, rect: PageRect | null): void {
  let draft = page.querySelector<HTMLElement>(`.${DRAFT_CLASS}`);
  if (!rect) { draft?.remove(); return; }
  if (!draft) {
    draft = renderElement("div", { class: DRAFT_CLASS });
    page.append(draft);
  }
  placeRect(draft, rect);
  draft.style.height = `${rect.h * 100}%`;
}

/** Positioned in percent of the page, so the box keeps its place while pdf.js scales the page before re-rendering it; the height follows the text. */
export function placeRect(el: HTMLElement, r: PageRect): void {
  el.style.left = `${r.x * 100}%`;
  el.style.top = `${r.y * 100}%`;
  el.style.width = `${r.w * 100}%`;
}

export function pageElement(pageNumber: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#viewer .page[data-page-number="${pageNumber}"]`);
}

/** The smallest box in page fractions at the box's current font size and page frame. */
export function minimumBox(el: HTMLElement, frame: PageFrame): { w: number; h: number } {
  const em = Number.parseFloat(getComputedStyle(el).fontSize) || FALLBACK_EM_PX;
  return { w: (MIN_EM.w * em) / frame.width, h: (MIN_EM.h * em) / frame.height };
}

/** Puts the DOM caret at a viewport point inside `root`, where the browser can tell; ProseMirror then takes it as its selection. */
export function placeCaretAt(root: HTMLElement, at: { x: number; y: number }): void {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  };
  let range = doc.caretRangeFromPoint?.(at.x, at.y) ?? null;
  if (!range) {
    const pos = doc.caretPositionFromPoint?.(at.x, at.y);
    if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
  }
  if (!range || !root.contains(range.startContainer)) { return; }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
