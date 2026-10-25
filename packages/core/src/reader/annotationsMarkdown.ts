/**
 * Renders a paper's annotations as a Markdown reading-notes document grouped by page.
 */
import type { Annotation } from "../model/index.js";
import { compareAnnotations } from "./sidecar/index.js";
import { formatInTextCitation } from "../library/index.js";
import { normalizeQuote, type CitablePaper } from "./citationFormat.js";

/**
 * Highlights become block quotes tagged with their colour; notes and comments become plain paragraphs.
 * @returns a Markdown document ending in a newline.
 */
export function formatAnnotationsMarkdown(paper: CitablePaper, annotations: readonly Annotation[]): string {
  const lines: string[] = [`# ${paper.title}`, "", `${formatInTextCitation(paper)} · \`@${paper.citeKey}\``, ""];
  if (annotations.length === 0) {
    lines.push("_No annotations._", "");
    return lines.join("\n");
  }
  const sorted = [...annotations].sort(compareAnnotations);
  let page = -1;
  for (const ann of sorted) {
    if (ann.pageNumber !== page) {
      page = ann.pageNumber;
      lines.push(`## Page ${page}`, "");
    }
    const body = normalizeQuote(ann.content);
    if (ann.type === "highlight") {
      lines.push(`> ${body}`, "", `<!-- highlight: ${ann.color ?? "yellow"} --> [@${paper.citeKey}, p. ${page}]`, "");
    } else {
      lines.push(`**${ann.type[0]!.toUpperCase()}${ann.type.slice(1)}:** ${body}`, "");
    }
  }
  return lines.join("\n");
}
