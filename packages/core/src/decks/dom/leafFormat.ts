// Formatting of the text selection inside one open deck leaf: marks (b, i, u, s), colour spans and links wrapped around or unwrapped
// from the selection of the leaf's document, which then covers the same text; leafInlineHtml reads the leaf back as allowed inline HTML.
import { isDeckInlineColor, safeDeckHref, sanitizeDeckInline } from "../deckInline.js";

export type LeafMark = "b" | "i" | "u" | "s";

/** The tags that already carry each mark. */
const MARK_TAGS: Record<LeafMark, readonly string[]> = { b: ["b", "strong"], i: ["i", "em"], u: ["u"], s: ["s", "strike", "del"] };
/** Inline wrappers removed when a change leaves them without text. */
const INLINE_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "small", "mark", "code", "span", "a", "font"]);

type Match = (element: Element) => boolean;
interface Selected { start: number; end: number; texts: Text[] }

const tagIs = (tags: readonly string[]): Match => (element) => tags.includes(element.tagName.toLowerCase());
const isColorSpan: Match = (element) => element.tagName.toLowerCase() === "span" && /(?:^|;)\s*color\s*:/i.test(element.getAttribute("style") ?? "");
const isLink: Match = (element) => element.tagName.toLowerCase() === "a";

function textNodes(leaf: HTMLElement): Text[] {
  const walker = leaf.ownerDocument.createTreeWalker(leaf, 4 /* NodeFilter.SHOW_TEXT */);
  const out: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
  return out;
}

/** The character offset of a boundary point from the start of the leaf. */
function offsetOf(leaf: HTMLElement, node: Node, offset: number): number {
  const range = leaf.ownerDocument.createRange();
  range.setStart(leaf, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** The non-collapsed selection wholly inside the leaf, as character offsets and the text nodes it covers; null otherwise. */
function selectedIn(leaf: HTMLElement): Selected | null {
  const selection = leaf.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !leaf.contains(range.startContainer) || !leaf.contains(range.endContainer)) return null;
  const start = offsetOf(leaf, range.startContainer, range.startOffset);
  const end = offsetOf(leaf, range.endContainer, range.endOffset);
  const texts: Text[] = [];
  let at = 0;
  for (const text of textNodes(leaf)) {
    const length = text.data.length;
    if (length > 0 && at < end && at + length > start) texts.push(text);
    at += length;
  }
  return texts.length > 0 ? { start, end, texts } : null;
}

/** Selects the leaf's text from `start` to `end` (character offsets). */
function restore(leaf: HTMLElement, start: number, end: number): void {
  const texts = textNodes(leaf);
  const range = leaf.ownerDocument.createRange();
  let at = 0;
  let started = false;
  for (const text of texts) {
    const length = text.data.length;
    if (!started && start < at + length) { range.setStart(text, start - at); started = true; }
    if (started && end <= at + length) { range.setEnd(text, end - at); break; }
    at += length;
  }
  const selection = leaf.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The ancestors of a node below the leaf that match. */
function ancestors(node: Node, leaf: HTMLElement, match: Match): Element[] {
  const out: Element[] = [];
  for (let element = node.parentElement; element && element !== leaf; element = element.parentElement) if (match(element)) out.push(element);
  return out;
}

function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

/** Wraps the selection in `wrapper`, unwrapping elements inside it that match `inner` so the new one wins. */
function wrapSelection(leaf: HTMLElement, wrapper: HTMLElement, inner: Match): void {
  const range = leaf.ownerDocument.getSelection()!.getRangeAt(0);
  wrapper.append(range.extractContents());
  for (const element of Array.from(wrapper.querySelectorAll("*")).filter(inner)) unwrap(element);
  range.insertNode(wrapper);
}

/** Drops inline wrappers left empty, merges text nodes and selects the same text again. */
function finish(leaf: HTMLElement, selected: Selected): true {
  for (const element of Array.from(leaf.querySelectorAll("*")).reverse()) {
    if (INLINE_TAGS.has(element.tagName.toLowerCase()) && !element.hasChildNodes()) element.remove();
  }
  leaf.normalize();
  restore(leaf, selected.start, selected.end);
  return true;
}

/** Unwraps every element matching `match` that holds selected text; false when there is none. */
function unwrapSelected(leaf: HTMLElement, selected: Selected, match: Match): boolean {
  const found = new Set(selected.texts.flatMap((text) => ancestors(text, leaf, match)));
  if (found.size === 0) return false;
  for (const element of found) unwrap(element);
  return finish(leaf, selected);
}

/** Toggles a mark on the selection: unwraps it when every selected text already has it, else wraps the selection in a new element. */
export function toggleLeafMark(leaf: HTMLElement, mark: LeafMark): boolean {
  const selected = selectedIn(leaf);
  if (!selected) return false;
  const match = tagIs(MARK_TAGS[mark]);
  if (selected.texts.every((text) => ancestors(text, leaf, match).length > 0)) return unwrapSelected(leaf, selected, match);
  wrapSelection(leaf, leaf.ownerDocument.createElement(mark), match);
  return finish(leaf, selected);
}

/** Colours the selection in a span; null unwraps the colour spans holding selected text; an invalid colour changes nothing. */
export function setLeafColor(leaf: HTMLElement, color: string | null): boolean {
  const selected = selectedIn(leaf);
  if (!selected) return false;
  if (color === null) return unwrapSelected(leaf, selected, isColorSpan);
  const value = color.trim();
  if (!isDeckInlineColor(value)) return false;
  const span = leaf.ownerDocument.createElement("span");
  span.setAttribute("style", `color: ${value}`);
  wrapSelection(leaf, span, isColorSpan);
  return finish(leaf, selected);
}

/** Links the selection to a safe href; null unwraps the links holding selected text; an unsafe href changes nothing. */
export function setLeafLink(leaf: HTMLElement, href: string | null): boolean {
  const selected = selectedIn(leaf);
  if (!selected) return false;
  if (href === null) return unwrapSelected(leaf, selected, isLink);
  const safe = safeDeckHref(href);
  if (safe === null) return false;
  const link = leaf.ownerDocument.createElement("a");
  link.setAttribute("href", safe);
  wrapSelection(leaf, link, isLink);
  return finish(leaf, selected);
}

/** The href of the link holding the start of the selection inside the leaf, or "". */
export function leafLinkHref(leaf: HTMLElement): string {
  const selected = selectedIn(leaf);
  const first = selected?.texts[0];
  return first ? (ancestors(first, leaf, isLink)[0]?.getAttribute("href") ?? "") : "";
}

/** The leaf's content as allowed inline HTML, data-math elements left out. */
export function leafInlineHtml(leaf: HTMLElement): string {
  const copy = leaf.cloneNode(true) as HTMLElement;
  for (const math of Array.from(copy.querySelectorAll("[data-math]"))) math.remove();
  return sanitizeDeckInline(copy.innerHTML);
}
