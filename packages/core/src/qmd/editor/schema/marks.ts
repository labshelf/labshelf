// Declares the marks of LabShelf Markdown: emphasis, strong, inline code and links.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { MarkSpec } from "prosemirror-model";

/** `marker` is the delimiter character, `*` or `_`; strong writes it twice. */
const marker = { marker: { default: "*", validate: "string" } };

export const marks: Record<string, MarkSpec> = {
  em: {
    attrs: marker,
    parseDOM: [{ tag: "em" }, { tag: "i" }],
    toDOM: () => ["em", 0],
  },
  strong: {
    attrs: marker,
    parseDOM: [{ tag: "strong" }, { tag: "b" }],
    toDOM: () => ["strong", 0],
  },
  /** `ticks` is the length of the backtick run around the code. */
  code: {
    attrs: { ticks: { default: 1, validate: "number" } },
    parseDOM: [{ tag: "code" }],
    toDOM: () => ["code", 0],
  },
  /** `labshelf:` hrefs are ordinary links. */
  link: {
    attrs: { href: { validate: "string" } },
    inclusive: false,
    toDOM: (mark) => ["a", { href: mark.attrs.href as string }, 0],
  },
};
