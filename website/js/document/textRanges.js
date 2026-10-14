// Character offsets inside a page and wrapping a range in marks, so highlights and find hits survive across text nodes and reloads.

const SKIP = "svg, video, .page-head, .folio, .copy, .marker, .fig-tabs";

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

/** The text the marks can wrap, in document order. */
export function plainText(root) {
  return textNodes(root).map((n) => n.data).join("");
}

/** Character offsets of `range` within `root`'s wrappable text. */
export function rangeOffsets(root, range) {
  let pos = 0;
  let start = -1;
  let end = -1;
  for (const node of textNodes(root)) {
    if (node === range.startContainer) start = pos + range.startOffset;
    if (node === range.endContainer) end = pos + range.endOffset;
    pos += node.data.length;
  }
  if (start < 0 || end < 0) {
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    start = before.toString().length;
    end = start + range.toString().length;
  }
  return { start, end };
}

/** A DOM range for the characters [start, end) of `root`'s text, or null when out of bounds. */
export function textRange(root, start, end) {
  if (!root || end <= start) return null;
  const range = document.createRange();
  let pos = 0;
  let started = false;
  for (const node of textNodes(root)) {
    const len = node.data.length;
    if (!started && start <= pos + len) {
      range.setStart(node, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

/** Wrap every text segment of `range` in a <mark> that `decorate` configures. Returns the marks. */
export function wrapRange(range, decorate) {
  const marks = [];
  const common = range.commonAncestorContainer;
  const root = common.nodeType === Node.TEXT_NODE ? common.parentNode : common;
  for (const node of textNodes(root).filter((n) => range.intersectsNode(n))) {
    let target = node;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    if (to <= from) continue;
    if (to < target.data.length) target.splitText(to);
    if (from > 0) target = target.splitText(from);
    const mark = document.createElement("mark");
    decorate(mark);
    target.replaceWith(mark);
    mark.append(target);
    marks.push(mark);
  }
  return marks;
}

export function unwrap(mark) {
  const parent = mark.parentNode;
  mark.replaceWith(...mark.childNodes);
  parent?.normalize();
}
