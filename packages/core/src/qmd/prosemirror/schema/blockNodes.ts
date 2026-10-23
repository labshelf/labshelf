// Declares the block nodes of LabShelf Markdown, each keeping the source spelling it was read with.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { AttributeSpec, NodeSpec } from "prosemirror-model";

const text = (fallback: string | null): AttributeSpec => ({ default: fallback, validate: fallback === null ? "string|null" : "string" });

/**
 * `gap` holds the exact blank lines before a block, line endings included; null means the canonical gap: none for
 * the first block of its container and for lists and items inside an item, one empty line otherwise.
 */
const gap = { gap: text(null) };

export const blockNodes: Record<string, NodeSpec> = {
  /** `eol` is the body's line ending; `trailing` the exact blank lines after the last block; `unterminated` a last line without ending. */
  doc: {
    content: "block+",
    attrs: { eol: text("\n"), trailing: text(""), unterminated: { default: false, validate: "boolean" } },
  },
  paragraph: {
    group: "block",
    content: "inline*",
    attrs: gap,
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },
  /** `space` is the whitespace between the hashes and the text. */
  heading: {
    group: "block",
    content: "inline*",
    defining: true,
    attrs: { level: { default: 1, validate: "number" }, space: text(null), ...gap },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  },
  bullet_list: {
    group: "block",
    content: "(list_item | task_item)+",
    attrs: { marker: text("-"), ...gap },
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },
  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: { order: { default: 1, validate: "number" }, delimiter: text("."), ...gap },
    parseDOM: [{ tag: "ol" }],
    toDOM: (node) => ["ol", { start: node.attrs.order as number }, 0],
  },
  /** `prefix` is the exact marker text before the item's content, such as `2. ` or `-   `. */
  list_item: {
    content: "paragraph block*",
    defining: true,
    attrs: { prefix: text(null), ...gap },
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },
  /** `prefix` is the text before `[`, `mark` the checked letter (`x` or `X`), `space` the text between `]` and the content. */
  task_item: {
    content: "paragraph block*",
    defining: true,
    attrs: { checked: { default: false, validate: "boolean" }, mark: text("x"), prefix: text(null), space: text(null), ...gap },
    toDOM: (node) => ["li", { "data-task": node.attrs.checked ? "done" : "open" }, 0],
  },
  /** `label` is `eq-…` or null. */
  math_display: {
    group: "block",
    atom: true,
    attrs: { tex: text(""), label: text(null), ...gap },
    leafText: (node) => node.attrs.tex as string,
    toDOM: (node) => ["div", { "data-math": "display" }, node.attrs.tex as string],
  },
  /**
   * `options` and `code` hold whole lines, each ending with `\n`. `fence` is the opening fence, `info` the exact text
   * after it, `close` the exact closing line; they are used while they still agree with `lang` and `fence`.
   */
  code_cell: {
    group: "block",
    atom: true,
    attrs: {
      lang: text(null), options: text(""), code: text(""), fence: text("```"), info: text(null), close: text(null), ...gap,
    },
    leafText: (node) => (node.attrs.options as string) + (node.attrs.code as string),
    toDOM: (node) => ["pre", { "data-lang": (node.attrs.lang as string | null) ?? "" }, node.attrs.code as string],
  },
  /** `raw` is the exact bytes of the whole output block; the other attributes are read from its opening line. */
  output: {
    group: "block",
    atom: true,
    attrs: { cell: text(""), source: text(""), engine: text(null), ran: text(null), raw: text(""), ...gap },
    leafText: (node) => node.attrs.raw as string,
    toDOM: (node) => ["pre", { "data-output": node.attrs.cell as string }, node.attrs.raw as string],
  },
  /** Markdown outside the subset, kept byte for byte (line endings included) and shown as source. */
  raw_block: {
    group: "block",
    atom: true,
    attrs: { text: text(""), ...gap },
    leafText: (node) => node.attrs.text as string,
    toDOM: (node) => ["pre", { "data-raw": "" }, node.attrs.text as string],
  },
};
