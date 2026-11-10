// Places on a built source deck's page, and the plain words of source text: the rectangles the page map gives poster blocks, the text runs a
// PDF page holds, and a note or block read without its markup.

/** A rectangle on a page in PDF points from the page's top-left corner; pages are 1-based. */
export interface SourceDeckRect { page: number; left: number; top: number; right: number; bottom: number }

/** One text run of a page, in PDF points from the page's top-left corner. */
export interface SourceDeckTextRun { text: string; left: number; top: number; width: number; pt: number }

/** The words a reader sees of a node's source: comments, math, command names and group braces dropped. */
export function plainSourceText(format: "latex" | "typst", source: string): string {
  const text = format === "latex"
    ? source.replace(/(^|[^\\])%.*$/gm, "$1").replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " ").replace(/\\(?:begin|end)\s*\{[^}]*\}/g, " ")
      .replace(/\\(?:includegraphics|label|ref|cite|column|usepackage)\b\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ").replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ").replace(/[{}\\&]/g, " ")
    : source.replace(/\/\/.*$/gm, "").replace(/\$[^$]*\$/g, " ").replace(/#[A-Za-z-.]+(\([^)]*\))?/g, " ").replace(/[[\]#*_=+-]/g, " ");
  return text.replace(/\s+/g, " ").trim();
}
