/** Adds the line that loads the generated bibliography to a project's main file, once. */

import type { ProjectFormat } from "../project/index.js";

export type BibliographyLineResult =
  | { kind: "present" | "added"; text: string }
  /** Typst accepts one bibliography call; an existing one is the user's to extend. */
  | { kind: "conflict"; text: string };

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function latexLine(text: string, bibFile: string): BibliographyLineResult {
  const base = bibFile.replace(/\.bib$/, "");
  if (new RegExp(`\\\\(?:bibliography|addbibresource)\\{[^}]*\\b${escapeRegExp(base)}(?:\\.bib)?\\b`).test(text)) {
    return { kind: "present", text };
  }
  const resources = [...text.matchAll(/^[ \t]*\\addbibresource\{[^}]*\}[^\n]*$/gm)];
  const last = resources.at(-1);
  if (last) {
    const end = last.index + last[0].length;
    return { kind: "added", text: `${text.slice(0, end)}\n\\addbibresource{${bibFile}}${text.slice(end)}` };
  }
  if (/\\bibliography\{/.test(text)) {
    return { kind: "added", text: text.replace(/\\bibliography\{([^}]*)\}/, (_, list: string) => `\\bibliography{${list},${base}}`) };
  }
  const lines = `\\bibliographystyle{plain}\n\\bibliography{${base}}\n\n`;
  const close = text.lastIndexOf("\\end{document}");
  if (close < 0) { return { kind: "added", text: `${text}\n${lines}` }; }
  return { kind: "added", text: `${text.slice(0, close)}${lines}${text.slice(close)}` };
}

function typstLine(text: string, bibFile: string): BibliographyLineResult {
  if (new RegExp(`#bibliography\\([^)]*"${escapeRegExp(bibFile)}"`).test(text)) { return { kind: "present", text }; }
  if (/#bibliography\(/.test(text)) { return { kind: "conflict", text }; }
  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return { kind: "added", text: `${text}${separator}#bibliography("${bibFile}")\n` };
}

/** The main file's text with the bibliography loaded; `bibFile` is relative to the main file's folder. */
export function withBibliographyLine(format: ProjectFormat, text: string, bibFile: string): BibliographyLineResult {
  return format === "latex" ? latexLine(text, bibFile) : typstLine(text, bibFile);
}
