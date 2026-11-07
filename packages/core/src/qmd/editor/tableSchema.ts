// Declares the schema nodes of a Markdown pipe table: the table, its rows and its header and body cells.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { DOMOutputSpec, Node, NodeSpec } from "prosemirror-model";

export type ColumnAlign = "left" | "center" | "right" | null;

function validateAlign(value: unknown): void {
  const valid = (align: unknown) => align === null || align === "left" || align === "center" || align === "right";
  if (!Array.isArray(value) || !value.every(valid)) { throw new RangeError("table align must be a list of left, center, right or null"); }
}

const cellAlign = {
  align: { default: null, validate: (value: unknown) => validateAlign([value]) },
};

const cellDom = (tag: "th" | "td") => (node: Node): DOMOutputSpec => {
  const align = node.attrs.align as ColumnAlign;
  return [tag, align ? { style: `text-align: ${align}` } : {}, 0];
};

/**
 * `align` holds one entry per column, as the separator row writes it; `raw` is the exact source of the table, written
 * back while the table still reads as it; `gap` is the blank lines before it, as on every block. A cell's `align`
 * repeats its column's, so the cell can render it on its own.
 */
export const tableNodes: Record<string, NodeSpec> = {
  table: {
    group: "block",
    content: "table_row+",
    isolating: true,
    attrs: {
      align: { default: [], validate: validateAlign },
      raw: { default: null, validate: "string|null" },
      gap: { default: null, validate: "string|null" },
    },
    parseDOM: [{ tag: "table" }],
    toDOM: () => ["div", { class: "qmd-table" }, ["table", ["tbody", 0]]],
  },
  table_row: {
    content: "table_header+ | table_cell+",
    parseDOM: [{ tag: "tr" }],
    toDOM: () => ["tr", 0],
  },
  table_header: {
    content: "inline*",
    isolating: true,
    attrs: cellAlign,
    parseDOM: [{ tag: "th" }],
    toDOM: cellDom("th"),
  },
  table_cell: {
    content: "inline*",
    isolating: true,
    attrs: cellAlign,
    parseDOM: [{ tag: "td" }],
    toDOM: cellDom("td"),
  },
};
