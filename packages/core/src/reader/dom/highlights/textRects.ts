// Finds where a highlight's text sits on a rendered page, as boxes in the page's 0..1 space.
import type { AnnotationPosition } from "../../../model/index.js";
import { boxInPage, type PageFrame } from "./pageFrame.js";

interface CharAt {
  node: Text;
  offset: number;
}

/**
 * Looks for `content` in the text-layer text that overlaps `box`, ignoring whitespace, because line breaks and
 * spacing in the text layer rarely match the copied selection.
 * @returns one box per line of the matched text, or null when the text layer is missing or does not contain it.
 */
export function textBoxes(page: HTMLElement, frame: PageFrame, content: string, box: AnnotationPosition): AnnotationPosition[] | null {
  const needle = content.replace(/\s+/g, "");
  const textLayer = page.querySelector(".textLayer");
  if (!needle || !textLayer) { return null; }
  const chars = charsInBox(textLayer, frame, box);
  const start = chars.map((c) => c.node.data[c.offset]).join("").indexOf(needle);
  if (start < 0) { return null; }
  const first = chars[start]!;
  const last = chars[start + needle.length - 1]!;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  const boxes = [...range.getClientRects()].map((r) => boxInPage(r, frame)).filter((b): b is AnnotationPosition => b !== null);
  return boxes.length > 0 ? boxes : null;
}

/** Every non-whitespace character of the text nodes whose element overlaps the box, in document order. */
function charsInBox(textLayer: Element, frame: PageFrame, box: AnnotationPosition): CharAt[] {
  const left = frame.left + box.x * frame.width;
  const top = frame.top + box.y * frame.height;
  const right = left + box.width * frame.width;
  const bottom = top + box.height * frame.height;
  const chars: CharAt[] = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const r = node.parentElement?.getBoundingClientRect();
    if (!r || r.right <= left || r.left >= right || r.bottom <= top || r.top >= bottom) { continue; }
    for (let offset = 0; offset < node.data.length; offset++) {
      if (!/\s/.test(node.data[offset]!)) { chars.push({ node, offset }); }
    }
  }
  return chars;
}
