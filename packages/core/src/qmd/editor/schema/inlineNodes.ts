// Declares the inline nodes of LabShelf Markdown: text, line breaks, math, images and citations.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { NodeSpec } from "prosemirror-model";

function validateKeys(value: unknown): void {
  if (!Array.isArray(value) || !value.every((key) => typeof key === "string")) { throw new RangeError("citation keys must be strings"); }
}

export const inlineNodes: Record<string, NodeSpec> = {
  text: { group: "inline" },
  /** `marker` is what precedes the line ending: `\` for a hard break, the trailing spaces or nothing for a soft one. */
  hard_break: {
    group: "inline",
    inline: true,
    selectable: false,
    attrs: { marker: { default: "\\", validate: "string" } },
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
  math_inline: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { tex: { default: "", validate: "string" } },
    leafText: (node) => node.attrs.tex as string,
    toDOM: (node) => ["span", { "data-math": "inline" }, node.attrs.tex as string],
  },
  image: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { src: { default: "", validate: "string" }, alt: { default: "", validate: "string" } },
    toDOM: (node) => ["img", { src: node.attrs.src as string, alt: node.attrs.alt as string }],
  },
  /** `raw` is the exact source, used while it still reads as `keys`. */
  citation: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { keys: { default: [], validate: validateKeys }, raw: { default: null, validate: "string|null" } },
    toDOM: (node) => ["span", { "data-citation": (node.attrs.keys as string[]).join(" ") }, (node.attrs.keys as string[]).map((key) => `@${key}`).join("; ")],
  },
};
