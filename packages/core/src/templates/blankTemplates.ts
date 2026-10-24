/** Builds the blank template of a new project: one article per format, titled with the user's title. */

import type { ProjectFormat } from "../writing/project/index.js";
import type { TemplateFile } from "./sources/index.js";
import type { ProjectTemplate } from "./templateManifest/index.js";

const LATEX_SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#",
  "^": "\\textasciicircum{}", _: "\\_", "%": "\\%", "~": "\\textasciitilde{}",
};

function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#^_%~]/g, (char) => LATEX_SPECIALS[char]!);
}

function escapeTypstString(text: string): string {
  return text.replace(/["\\]/g, (char) => `\\${char}`);
}

// Neither template cites anything yet: a bibliography line pointing at a file that does not exist breaks the
// Typst build, so the line is added with the first citation.
function latexArticle(title: string): string {
  return [
    "\\documentclass{article}",
    "\\usepackage{hyperref}",
    "",
    `\\title{${escapeLatex(title)}}`,
    "\\author{}",
    "\\date{\\today}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    "\\section{Introduction}",
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

function typstArticle(title: string): string {
  return [
    `#let title = "${escapeTypstString(title)}"`,
    "#set document(title: title)",
    "#set page(paper: \"a4\", numbering: \"1\")",
    "#set heading(numbering: \"1.\")",
    "",
    "#align(center, text(17pt, weight: \"bold\", title))",
    "",
    "= Introduction",
    "",
  ].join("\n");
}

/** The built-in template and its single main file for a new project. */
export function blankTemplate(format: ProjectFormat, title: string): { template: ProjectTemplate; files: TemplateFile[] } {
  const [main, text] = format === "latex" ? ["main.tex", latexArticle(title)] : ["main.typ", typstArticle(title)];
  return { template: { id: `blank-${format}`, format, main }, files: [{ path: main, bytes: new TextEncoder().encode(text) }] };
}
