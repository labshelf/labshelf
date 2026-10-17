// Finds where a piece of rendered text sits in a webview, in workbench page coordinates.

/**
 * @returns the box of the `length` characters at the first occurrence of `needle` (from `offset` inside it) in a
 * text node under `scope`, or null when the text is not rendered.
 */
export async function textBox(frame, needle, { scope = ".textLayer", offset = 0, length = needle.length - offset } = {}) {
  const box = await frame.evaluate(({ needle, scope, offset, length }) => {
    for (const root of document.querySelectorAll(scope)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.data.indexOf(needle);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at + offset);
        range.setEnd(node, at + offset + length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  }, { needle, scope, offset, length });
  if (!box) return null;
  const origin = await (await frame.frameElement()).boundingBox();
  return { ...box, x: box.x + origin.x, y: box.y + origin.y };
}

/** @returns the left-middle and right-middle points of a box, where a text selection drag starts and ends. */
export function edges(box) {
  const y = box.y + box.height / 2;
  return { start: { x: box.x + 1, y }, end: { x: box.x + box.width - 1, y } };
}
