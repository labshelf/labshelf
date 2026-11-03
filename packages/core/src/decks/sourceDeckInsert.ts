// Edits a node of a source deck tree as a whole: a new element after it or at the end of its body, and moving, duplicating or deleting it among its siblings.
import type { SourceDeckNode, SourceDeckRange } from "./sourceDeckBlocks.js";
import type { SourceDeckChange } from "./sourceDeckEdit.js";
import { lineStart } from "./sourceDeckOutline.js";
import type { SourceDeckFormat } from "./sourceDecks.js";
import { trimEnd } from "./sourceDeckScan.js";

/** The elements the insert toolbar adds. */
export type SourceDeckElementKind = "text" | "figure" | "equation" | "table" | "list";

const LATEX_ELEMENT: Record<SourceDeckElementKind, (src: string) => string> = {
  text: () => "New text.",
  figure: (src) => `\\begin{center}\n  \\includegraphics[width=0.8\\linewidth]{${src}}\n\\end{center}`,
  equation: () => "\\[ E = mc^2 \\]",
  table: () => "\\begin{tabular}{ll}\n  A & B \\\\\n  1 & 2\n\\end{tabular}",
  list: () => "\\begin{itemize}\n  \\item First point\n  \\item Second point\n\\end{itemize}",
};

const TYPST_ELEMENT: Record<SourceDeckElementKind, (src: string) => string> = {
  text: () => "New text.",
  figure: (src) => `#figure(image("${src}", width: 80%), caption: [Caption])`,
  equation: () => "$ E = m c^2 $",
  table: () => "#table(columns: 2, [A], [B], [1], [2])",
  list: () => "- First point\n- Second point",
};

/** The leading whitespace of the line that holds `offset`. */
const indentAt = (text: string, offset: number): string => /^[ \t]*/.exec(text.slice(lineStart(text, offset)))![0];

/**
 * A new element of `kind` after `target`: at the end of a container's body (a column, block or slide), else right after an element,
 * as its own paragraph with the indentation of its neighbour. `src` is the figure's path. Null for a container without a body.
 */
export function insertSourceElement(format: SourceDeckFormat, text: string, target: Pick<SourceDeckNode, "range" | "bodyRange" | "children">, kind: SourceDeckElementKind, src = "figure"): SourceDeckChange | null {
  let at: number; let indent: string;
  if (target.children) {
    if (!target.bodyRange) return null;
    at = trimEnd(text, target.bodyRange[0], target.bodyRange[1]);
    const last = target.children.at(-1);
    indent = last ? indentAt(text, last.range[0]) : `${indentAt(text, target.range[0])}  `;
  } else {
    at = target.range[1];
    indent = indentAt(text, target.range[0]);
  }
  const snippet = (format === "latex" ? LATEX_ELEMENT : TYPST_ELEMENT)[kind](src).replace(/\n/g, `\n${indent}`);
  const empty = target.children !== undefined && target.children.length === 0 && at === target.bodyRange?.[0];
  const insert = `${empty ? "\n" : "\n\n"}${indent}${snippet}`;
  return { text: text.slice(0, at) + insert + text.slice(at), cursor: at + insert.length };
}

/** A node's span with the whole lines it stands alone on, so moving or deleting it leaves no blank indentation behind. */
function lineSpan(text: string, range: SourceDeckRange): SourceDeckRange {
  const start = lineStart(text, range[0]);
  const alone = /^[ \t]*$/.test(text.slice(start, range[0]));
  const after = /^[ \t]*(?:\r?\n|$)/.exec(text.slice(range[1]));
  if (!alone || !after) return range;
  return [start, range[1] + after[0].length];
}

/** The text without `node`; its lines go when it stands alone on them. */
export function deleteSourceDeckNode(text: string, node: Pick<SourceDeckNode, "range">): SourceDeckChange {
  const [from, to] = lineSpan(text, node.range);
  return { text: text.slice(0, from) + text.slice(to), cursor: from };
}

/** The text with a copy of `node` right after it; the cursor goes to the copy. */
export function duplicateSourceDeckNode(text: string, node: Pick<SourceDeckNode, "range">): SourceDeckChange {
  const span = lineSpan(text, node.range);
  if (span !== node.range) {
    const copy = text.slice(span[0], span[1]);
    const glue = copy.endsWith("\n") ? "" : "\n";
    return { text: text.slice(0, span[1]) + glue + copy + text.slice(span[1]), cursor: span[1] + glue.length + (node.range[0] - span[0]) };
  }
  const copy = text.slice(node.range[0], node.range[1]);
  return { text: text.slice(0, node.range[1]) + "\n" + copy + text.slice(node.range[1]), cursor: node.range[1] + 1 };
}

/**
 * The text with sibling `index` swapped with its neighbour in direction `by` (-1 up, 1 down); the cursor goes to the moved node.
 * Null at either end. The two spans keep the text between them.
 */
export function moveSourceDeckNode(text: string, siblings: readonly Pick<SourceDeckNode, "range">[], index: number, by: -1 | 1): SourceDeckChange | null {
  const other = index + by;
  if (!siblings[index] || !siblings[other]) return null;
  const [first, second] = by < 0 ? [siblings[other]!, siblings[index]!] : [siblings[index]!, siblings[other]!];
  const a = text.slice(first.range[0], first.range[1]);
  const b = text.slice(second.range[0], second.range[1]);
  const between = text.slice(first.range[1], second.range[0]);
  const next = text.slice(0, first.range[0]) + b + between + a + text.slice(second.range[1]);
  return { text: next, cursor: by < 0 ? first.range[0] : first.range[0] + b.length + between.length };
}
