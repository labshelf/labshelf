/** The LaTeX scanner of the prose ranges. */
import { lineEnd } from "../../text/index.js";
import { type RangeCollector, urlLength } from "./proseRanges.js";

const MATH_ENVIRONMENTS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "alignat", "alignat*", "eqnarray", "eqnarray*", "displaymath", "math",
  "split", "aligned", "gathered", "cases", "dmath", "dmath*",
]);

/** Environments whose whole body is not prose: verbatim, code, pictures and text in another language. */
const OPAQUE_ENVIRONMENTS = new Set([
  "verbatim", "verbatim*", "Verbatim", "Verbatim*", "BVerbatim", "lstlisting", "minted", "comment",
  "alltt", "tikzpicture", "pgfpicture", "picture", "otherlanguage", "otherlanguage*", "filecontents", "filecontents*",
]);

/** Brace arguments after `\begin{env}` that are not text (column specs, widths, languages). */
const ENVIRONMENT_ARGUMENTS: Record<string, number> = {
  tabular: 1, "tabular*": 2, tabularx: 2, tabulary: 2, longtable: 1, array: 1, minipage: 1, multicols: 1,
  "multicols*": 1, thebibliography: 1, wrapfigure: 2, subfigure: 1, tabu: 1, tblr: 1,
};

/** Commands whose every argument is not text. */
const NON_TEXT_COMMANDS = new Set([
  "ref", "eqref", "pageref", "autoref", "cref", "Cref", "crefrange", "Crefrange", "nameref", "vref", "Vref", "labelcref",
  "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear", "citeyearpar", "parencite", "textcite",
  "autocite", "footcite", "fullcite", "nocite", "Cite", "Citep", "Citet", "Parencite", "Textcite", "Autocite", "supercite",
  "smartcite", "cites", "parencites", "textcites",
  "label", "input", "include", "includeonly", "subfile", "import", "subimport", "includegraphics", "includepdf",
  "usepackage", "RequirePackage", "documentclass", "LoadClass", "url", "nolinkurl", "path",
  "newcommand", "renewcommand", "providecommand", "DeclareMathOperator", "newenvironment", "renewenvironment",
  "NewDocumentCommand", "RenewDocumentCommand", "DeclareDocumentCommand", "NewDocumentEnvironment", "newtheorem",
  "setlength", "addtolength", "setcounter", "addtocounter", "stepcounter", "refstepcounter", "settowidth", "settoheight",
  "hspace", "vspace", "hskip", "vskip", "rule", "raisebox", "resizebox", "scalebox", "linespread", "fontsize", "selectfont",
  "bibliography", "bibliographystyle", "addbibresource", "printbibliography", "bibitem",
  "color", "pagecolor", "definecolor", "colorlet", "pagestyle", "thispagestyle", "pagenumbering", "geometry",
  "hypersetup", "lstset", "setminted", "usetikzlibrary", "pgfplotsset", "tikzset", "graphicspath", "selectlanguage",
  "setdefaultlanguage", "setotherlanguage", "setotherlanguages", "setmainfont", "setsansfont", "setmonofont", "newfontfamily",
  "captionsetup", "sisetup", "SI", "si", "num", "ang", "qty", "unit", "newacronym", "acrodef", "ac", "acs", "acl", "acf",
  "acp", "gls", "glspl", "Gls", "Glspl", "newglossaryentry", "texttt", "foreignlanguage", "hyphenation", "newlength",
  "newcounter", "counterwithin", "numberwithin", "theoremstyle", "crefname", "Crefname",
]);

/** The preamble commands whose brace arguments are prose; the rest of a preamble is not. */
const PREAMBLE_TEXT_COMMANDS = new Set(["title", "author", "date", "subtitle", "thanks", "keywords"]);

/** Commands whose first argument is not text and whose later arguments are. */
const FIRST_ARGUMENT_COMMANDS = new Set(["href", "textcolor", "colorbox", "hyperref", "hyperlink", "hypertarget", "fcolorbox"]);

const INLINE_VERBATIM = new Set(["verb", "verb*", "lstinline", "mintinline", "Verb"]);

const DEFINITIONS = new Set(["def", "gdef", "edef", "xdef"]);

const LANGUAGE_NAMES = new Set([
  "english", "american", "british", "french", "german", "ngerman", "spanish", "portuguese", "brazil", "brazilian",
  "italian", "latin", "greek", "russian", "dutch", "polish", "catalan", "swedish", "danish", "norwegian", "finnish",
  "czech", "hungarian", "turkish", "arabic", "hebrew", "chinese", "japanese", "korean", "ukrainian", "romanian",
]);

/** Where `\\begin{document}` starts outside a comment, or -1 for a file without it (an `\\input` child). */
function documentStart(text: string): number {
  const pattern = /\\begin\s*\{document\}/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const lineFrom = text.lastIndexOf("\n", match.index) + 1;
    if (!/(?:^|[^\\])%/.test(text.slice(lineFrom, match.index))) return match.index;
  }
  return -1;
}

export function scanLatex(text: string, limit: number, out: RangeCollector): void {
  const body = documentStart(text);
  if (body < 0) { scanLatexRange(text, 0, limit, out); return; }
  scanPreamble(text, Math.min(body, limit), out);
  if (body < limit) scanLatexRange(text, body, limit, out);
}

/** The preamble's prose: only the brace arguments of the title commands, scanned as LaTeX. */
function scanPreamble(text: string, limit: number, out: RangeCollector): void {
  const command = /\\(?:([A-Za-z@]+)\*?|[^A-Za-z@])|%/g;
  for (let match = command.exec(text); match !== null && match.index < limit; match = command.exec(text)) {
    if (match[0] === "%") { command.lastIndex = lineEnd(text, match.index); continue; }
    if (!PREAMBLE_TEXT_COMMANDS.has(match[1] ?? "")) continue;
    let i = skipArguments(text, command.lastIndex, "optional");
    while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
    if (text[i] !== "{") continue;
    const close = balancedEnd(text, i, "{", "}");
    scanLatexRange(text, i + 1, Math.min(limit, close - 1), out);
    command.lastIndex = close;
  }
}

function scanLatexRange(text: string, from: number, limit: number, out: RangeCollector): void {
  let i = from;
  let proseFrom = from;
  const cut = (from: number, to: number): void => {
    out.add(proseFrom, from);
    proseFrom = to;
    i = to;
  };
  while (i < limit) {
    const char = text[i];
    const url = urlLength(text, i);
    if (url > 0) cut(i, i + url);
    else if (char === "%") cut(i, lineEnd(text, i));
    else if (char === "{" || char === "}" || char === "&" || char === "#") cut(i, i + 1);
    else if (char === "$") cut(i, latexDollarEnd(text, i));
    else if (char !== "\\") i++;
    else if (text[i + 1] === "(") cut(i, closeAfter(text, i + 2, "\\)"));
    else if (text[i + 1] === "[") cut(i, closeAfter(text, i + 2, "\\]"));
    else {
      const name = /^[A-Za-z@]+\*?/.exec(text.slice(i + 1, i + 60))?.[0];
      cut(i, name === undefined ? Math.min(text.length, i + 2) : latexCommandEnd(text, i, name));
    }
  }
  out.add(proseFrom, Math.min(i, limit));
}

/** Where the non-prose part of a command starting at `start` ends; its text arguments stay to be scanned. */
function latexCommandEnd(text: string, start: number, name: string): number {
  let i = start + 1 + name.length;
  const bare = name.endsWith("*") ? name.slice(0, -1) : name;
  if (name === "begin" || name === "end") return environmentCommandEnd(text, i, name);
  if (INLINE_VERBATIM.has(name)) return inlineVerbatimEnd(text, i, name === "mintinline");
  if (DEFINITIONS.has(bare)) {
    const cs = /^\s*\\(?:[A-Za-z@]+|.)/.exec(text.slice(i, i + 80));
    if (cs !== null) i += cs[0].length;
    const open = text.indexOf("{", i);
    return open < 0 ? i : balancedEnd(text, open, "{", "}");
  }
  if (NON_TEXT_COMMANDS.has(bare) || (bare.startsWith("text") && LANGUAGE_NAMES.has(bare.slice(4)))) {
    if (/^(?:new|renew|provide|Declare|New|Renew)/.test(bare)) {
      const cs = /^\s*\\[A-Za-z@]+/.exec(text.slice(i, i + 80));
      if (cs !== null) i += cs[0].length;
    }
    return skipArguments(text, i, "all");
  }
  if (FIRST_ARGUMENT_COMMANDS.has(bare)) return skipArguments(text, skipArguments(text, i, "optional"), "one");
  // Text commands: the name goes, a key=value option goes, the {..} arguments are prose.
  if (text[i] === "[") {
    const close = balancedEnd(text, i, "[", "]");
    if (text.slice(i, close).includes("=")) return close;
  }
  return i;
}

function environmentCommandEnd(text: string, start: number, name: "begin" | "end"): number {
  const env = /^\s*\{([^}]*)\}/.exec(text.slice(start, start + 80));
  if (env === null) return start;
  const envName = env[1] ?? "";
  let i = start + env[0].length;
  if (name === "end") return i;
  if (MATH_ENVIRONMENTS.has(envName) || OPAQUE_ENVIRONMENTS.has(envName)) {
    const endTag = `\\end{${envName}}`;
    const at = text.indexOf(endTag, i);
    return at < 0 ? text.length : at + endTag.length;
  }
  i = skipArguments(text, i, "optional");
  for (let n = ENVIRONMENT_ARGUMENTS[envName] ?? 0; n > 0; n--) i = skipArguments(text, i, "one");
  return skipArguments(text, i, "optional");
}

/** Skips `[..]` and `{..}` arguments: optional ones only, one brace argument (with optionals before it), or all of them. */
function skipArguments(text: string, start: number, mode: "optional" | "one" | "all"): number {
  let i = start;
  for (;;) {
    let j = i;
    while (text[j] === " " || text[j] === "\t") j++;
    const char = text[j];
    if (char === "[") { i = balancedEnd(text, j, "[", "]"); continue; }
    if (char === "{" && mode !== "optional") {
      i = balancedEnd(text, j, "{", "}");
      if (mode === "one") return i;
      continue;
    }
    return i;
  }
}

/** The offset past the bracket that closes the one at `open`, past escapes; the text end when it never closes. */
function balancedEnd(text: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === opener) depth++;
    else if (char === closer && --depth === 0) return i + 1;
    else if (opener === "[" && char === "\n" && text[i + 1] === "\n") return i;
  }
  return text.length;
}

function inlineVerbatimEnd(text: string, start: number, languageFirst: boolean): number {
  let i = skipArguments(text, start, "optional");
  if (languageFirst && text[i] === "{") i = balancedEnd(text, i, "{", "}");
  const delimiter = text[i];
  if (delimiter === undefined || delimiter === "\n") return i;
  if (delimiter === "{") return balancedEnd(text, i, "{", "}");
  const close = text.indexOf(delimiter, i + 1);
  const end = lineEnd(text, i);
  return close < 0 || close > end ? end : close + 1;
}

/** `$..$` or `$$..$$`, not past a blank line; an unclosed `$` is only the sign itself. */
function latexDollarEnd(text: string, start: number): number {
  const display = text[start + 1] === "$";
  const close = display ? "$$" : "$";
  for (let i = start + close.length; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text.startsWith(close, i)) return i + close.length;
    else if (text[i] === "\n" && /^\n[ \t]*\n/.test(text.slice(i, i + 40))) break;
  }
  return start + close.length;
}

function closeAfter(text: string, from: number, close: string): number {
  const at = text.indexOf(close, from);
  return at < 0 ? from : at + close.length;
}
