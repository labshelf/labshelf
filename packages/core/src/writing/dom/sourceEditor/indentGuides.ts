// Indent guides as in VS Code: a thin line at each indent level inside a line's leading whitespace, carried across blank lines.
import { getIndentUnit } from "@codemirror/language";
import { countColumn, type EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, layer, RectangleMarker } from "@codemirror/view";

/** How far a blank line looks up and down for the indent of its neighbours. */
const BLANK_SEARCH_LINES = 200;
const MAX_UNIT = 8;

const indentOf = (text: string, tabSize: number): number | undefined => {
  const leading = /^[ \t]*/.exec(text)![0];
  return leading.length === text.length ? undefined : countColumn(leading, tabSize);
};

// The unit is read from the file, as VS Code detects indentation: the commonest step up between consecutive non-blank lines.
const unitCache = new WeakMap<Text, number>();
function detectUnit(state: EditorState): number {
  const cached = unitCache.get(state.doc);
  if (cached !== undefined) return cached;
  const steps = new Map<number, number>();
  let previous = 0;
  for (const text of state.doc.iterLines()) {
    const indent = indentOf(text, state.tabSize);
    if (indent === undefined) continue;
    const step = indent - previous;
    if (step > 0 && step <= MAX_UNIT) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = indent;
  }
  let unit = getIndentUnit(state);
  let best = 0;
  for (const [step, count] of steps) if (count > best) { best = count; unit = step; }
  unitCache.set(state.doc, unit);
  return unit;
}

/** A blank line takes the smaller indent of its nearest non-blank neighbours, so a guide runs on through it and stops where the block ends. */
function blankIndent(doc: Text, lineNumber: number, tabSize: number): number {
  const find = (direction: 1 | -1): number => {
    for (let at = lineNumber + direction, steps = 0; at >= 1 && at <= doc.lines && steps < BLANK_SEARCH_LINES; at += direction, steps++) {
      const indent = indentOf(doc.line(at).text, tabSize);
      if (indent !== undefined) return indent;
    }
    return 0;
  };
  return Math.min(find(-1), find(1));
}

const guideLayer = layer({
  above: false,
  class: "ls-indent-guides",
  markers(view) {
    const { state } = view;
    const blocks = view.viewportLineBlocks;
    const start = blocks.length > 0 ? view.coordsAtPos(blocks[0]!.from, 1) : null;
    if (!start) return [];
    const unit = detectUnit(state);
    const step = unit * view.defaultCharacterWidth;
    // Layer coordinates start at the scroller's content corner.
    const scroller = view.scrollDOM.getBoundingClientRect();
    const left = (start.left - scroller.left) / view.scaleX + view.scrollDOM.scrollLeft;
    const top = (view.documentTop - scroller.top) / view.scaleY + view.scrollDOM.scrollTop;
    const markers: RectangleMarker[] = [];
    for (const block of blocks) {
      const line = state.doc.lineAt(block.from);
      const indent = indentOf(line.text, state.tabSize) ?? blankIndent(state.doc, line.number, state.tabSize);
      // A wrapped line starts its next rows at the margin, so its guides stay on the first row.
      const height = Math.min(block.height, view.defaultLineHeight);
      for (let column = 0; column < indent; column += unit) {
        markers.push(new RectangleMarker("ls-indent-guide", left + (column / unit) * step, top + block.top, 1, height));
      }
    }
    return markers;
  },
  update: (update) => update.docChanged || update.viewportChanged || update.geometryChanged,
});

const guideTheme = EditorView.theme({
  ".ls-indent-guide": { backgroundColor: "var(--ls-editor-indent-guide)" },
});

export function createIndentGuides(): Extension {
  return [guideLayer, guideTheme];
}
