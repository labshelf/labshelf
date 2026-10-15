/** Writes the main file of a new project: one blank article per format, titled with the user's title. */

import type { ProjectFormat } from "./projectFile.js";

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

/** The main file name and its text for a new project. */
export function projectTemplate(format: ProjectFormat, title: string): { main: string; text: string } {
  return format === "latex"
    ? { main: "main.tex", text: latexArticle(title) }
    : { main: "main.typ", text: typstArticle(title) };
}
