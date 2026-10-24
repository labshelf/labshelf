/** Counts the words of a LaTeX body the way texcount does: prose and headings count, markup and math do not. */
import { stripComments } from "./stripComments.js";

const MATH_ENVIRONMENTS = "equation|align|alignat|flalign|gather|multline|eqnarray|math|displaymath";
const CODE_ENVIRONMENTS = "verbatim|lstlisting|comment";
const IGNORED_ARGUMENT_COMMANDS =
  "label|ref|eqref|pageref|autoref|nameref|cref|Cref|vref|Vref|cpageref|Cpageref|[A-Za-z]*cite[A-Za-z]*" +
  "|usepackage|RequirePackage|documentclass|includegraphics|input|include|subfile|bibliography|bibliographystyle";

// Order matters: the alternatives are tried left to right at each offset.
const SKIPPED = new RegExp([
  String.raw`\\\\(?:\[[^\]]*\])?`,
  String.raw`\\begin\{((?:${MATH_ENVIRONMENTS}|${CODE_ENVIRONMENTS})\*?)\}[\s\S]*?\\end\{\1\}`,
  String.raw`\$\$[\s\S]*?\$\$`,
  String.raw`\\\[[\s\S]*?\\\]`,
  String.raw`\\\([\s\S]*?\\\)`,
  String.raw`\\\$`,
  String.raw`\$[^$]*\$`,
  String.raw`\\(?:${IGNORED_ARGUMENT_COMMANDS})\*?(?:\s*\[[^\]]*\])*\s*\{[^}]*\}`,
  String.raw`\\begin\{[^}]*\}(?:\[[^\]]*\])?`,
  String.raw`\\end\{[^}]*\}`,
].join("|"), "g");

const ACCENTED = /\\["'`^~=.]\{?([A-Za-z])\}?/g;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Counts words between `\begin{document}` and `\end{document}` when present, else in the whole text. */
export function countWords(text: string): number {
  let body = stripComments(text);
  const begin = body.indexOf("\\begin{document}");
  if (begin >= 0) {
    body = body.slice(begin + "\\begin{document}".length);
    const end = body.indexOf("\\end{document}");
    if (end >= 0) { body = body.slice(0, end); }
  }
  const prose = body
    .replace(SKIPPED, " ")
    .replace(ACCENTED, "$1")
    .replace(/\\[A-Za-z@]+\*?|\\./g, " ");
  return prose.match(WORD)?.length ?? 0;
}
