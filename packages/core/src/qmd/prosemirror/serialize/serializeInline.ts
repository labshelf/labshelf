// Writes inline ProseMirror content back as the inline Markdown of one paragraph or heading.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Fragment, Mark, Node } from "prosemirror-model";
import { matchCitation } from "../schema/index.js";

function codeSpan(code: string, ticks: number): string {
  const runs = new Set((code.match(/`+/g) ?? []).map((run) => run.length));
  let length = ticks;
  while (runs.has(length)) length++;
  const fence = "`".repeat(length);
  return fence + code + fence;
}

function citation(keys: string[], raw: string | null): string {
  const read = raw === null ? null : matchCitation(raw);
  const rawStillReads = read !== null && read.length === raw?.length && read.keys.join("\n") === keys.join("\n");
  return rawStillReads ? raw : `[${keys.map((key) => `@${key}`).join("; ")}]`;
}

function nodeSource(node: Node): string {
  const code = node.marks.find((mark) => mark.type.name === "code");
  if (node.isText) return code ? codeSpan(node.text ?? "", code.attrs.ticks as number) : node.text ?? "";
  const attrs = node.attrs;
  switch (node.type.name) {
    case "hard_break": return `${attrs.marker as string}\n`;
    case "math_inline": return `$${attrs.tex as string}$`;
    case "image": return `![${attrs.alt as string}](${attrs.src as string})`;
    case "citation": return citation(attrs.keys as string[], attrs.raw as string | null);
    default: throw new RangeError(`serializeInline: no Markdown for inline node "${node.type.name}"`);
  }
}

function opening(mark: Mark): string {
  if (mark.type.name === "link") return "[";
  return (mark.attrs.marker as string).repeat(mark.type.name === "strong" ? 2 : 1);
}

function closing(mark: Mark): string {
  return mark.type.name === "link" ? `](${mark.attrs.href as string})` : opening(mark);
}

/** Index of the first node from `index` on that lacks `mark`. */
function reach(nodes: readonly Node[], index: number, mark: Mark): number {
  let end = index;
  while (end < nodes.length && mark.isInSet(nodes[end]?.marks ?? [])) end++;
  return end;
}

export function serializeInline(content: Fragment): string {
  const nodes: Node[] = [];
  content.forEach((node) => nodes.push(node));
  const active: Mark[] = [];
  let source = "";
  nodes.forEach((node, index) => {
    const wanted = node.marks.filter((mark) => mark.type.name !== "code");
    let keep = 0;
    while (keep < active.length && active[keep]?.isInSet(wanted)) keep++;
    while (active.length > keep) source += closing(active.pop() as Mark);
    const opened = wanted
      .filter((mark) => !mark.isInSet(active))
      .map((mark) => ({ mark, end: reach(nodes, index, mark) }))
      .sort((a, b) => b.end - a.end || Number(b.mark.type.name === "link") - Number(a.mark.type.name === "link"));
    for (const { mark } of opened) {
      source += opening(mark);
      active.push(mark);
    }
    source += nodeSource(node);
  });
  while (active.length > 0) source += closing(active.pop() as Mark);
  return source;
}
