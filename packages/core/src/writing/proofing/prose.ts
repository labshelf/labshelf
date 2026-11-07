/**
 * Finds the prose of a LaTeX or Typst source as document-offset ranges, so proofing
 * checks text and not markup, math, code, references or text in another language.
 */
import { lineEnd } from "../../text/index.js";

export interface ProseRange {
  from: number;
  to: number;
}

/**
 * Returns the sorted, non-overlapping prose ranges of `text`; `from`/`to` restrict
 * the result to a window and give the same ranges as a full scan cut to it.
 */
export function findProseRanges(format: "latex" | "typst", text: string, from = 0, to = text.length): ProseRange[] {
  const start = Math.max(0, from);
  const end = Math.min(text.length, to);
  if (end <= start) return [];
  const collector = new RangeCollector();
  if (format === "latex") scanLatex(text, end, collector);
  else new TypstScanner(text, end, collector).run();
  return clip(collector.ranges, start, end);
}

/** Collects prose characters into merged ranges in scan order. */
class RangeCollector {
  readonly ranges: ProseRange[] = [];

  add(from: number, to: number): void {
    if (to <= from) return;
    const last = this.ranges[this.ranges.length - 1];
    if (last !== undefined && last.to >= from) last.to = Math.max(last.to, to);
    else this.ranges.push({ from, to });
  }
}

function clip(ranges: readonly ProseRange[], from: number, to: number): ProseRange[] {
  const out: ProseRange[] = [];
  for (const range of ranges) {
    const a = Math.max(range.from, from);
    const b = Math.min(range.to, to);
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}

const URL_AT = /^(?:https?|ftp):\/\/[^\s{}<>()[\]"]+/;

function urlLength(text: string, i: number): number {
  const char = text[i];
  if (char !== "h" && char !== "f") return 0;
  return URL_AT.exec(text.slice(i, i + 2000))?.[0].length ?? 0;
}

// ---------------------------------------------------------------- LaTeX

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
  "newcounter", "counterwithin", "numberwithin",
]);

/** Commands whose first argument is not text and whose later arguments are. */
const FIRST_ARGUMENT_COMMANDS = new Set(["href", "textcolor", "colorbox", "hyperref", "hyperlink", "hypertarget", "fcolorbox"]);

const INLINE_VERBATIM = new Set(["verb", "verb*", "lstinline", "mintinline", "Verb"]);

const DEFINITIONS = new Set(["def", "gdef", "edef", "xdef"]);

const LANGUAGE_NAMES = new Set([
  "english", "american", "british", "french", "german", "ngerman", "spanish", "portuguese", "brazil", "brazilian",
  "italian", "latin", "greek", "russian", "dutch", "polish", "catalan", "swedish", "danish", "norwegian", "finnish",
  "czech", "hungarian", "turkish", "arabic", "hebrew", "chinese", "japanese", "korean", "ukrainian", "romanian",
]);

function scanLatex(text: string, limit: number, out: RangeCollector): void {
  let i = 0;
  let proseFrom = 0;
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

// ---------------------------------------------------------------- Typst

const TYPST_LINE_KEYWORDS = new Set(["let", "set", "show", "import", "include", "if", "for", "while", "return", "context"]);

/** Walks Typst markup, code and content; prose is the markup outside code, math, raw, comments, labels and refs. */
class TypstScanner {
  private proseFrom = 0;

  constructor(private readonly text: string, private readonly limit: number, private readonly out: RangeCollector) {}

  run(): void {
    const end = this.markup(0, false);
    this.out.add(this.proseFrom, Math.min(end, this.limit));
  }

  /** Ends the prose run at `from` and resumes it at `to`, which it returns. */
  private cut(from: number, to: number): number {
    this.out.add(this.proseFrom, from);
    this.proseFrom = to;
    return to;
  }

  /** Scans markup from `start`; inside content it stops past the `]` that closes it. */
  private markup(start: number, inContent: boolean): number {
    const text = this.text;
    let i = start;
    let depth = 0;
    while (i < text.length && (inContent || i < this.limit)) {
      const char = text[i];
      const url = urlLength(text, i);
      if (url > 0) i = this.cut(i, i + url);
      else if (char === "]" && inContent && depth === 0) return this.cut(i, i + 1);
      else if (char === "]" && inContent) { depth--; i++; }
      else if (char === "[") { depth++; i++; }
      else if (char === "/" && text[i + 1] === "/") i = this.cut(i, lineEnd(text, i));
      else if (char === "/" && text[i + 1] === "*") i = this.cut(i, this.blockCommentEnd(i));
      else if (char === "\\") i = this.cut(i, Math.min(text.length, i + 2));
      else if (char === "$") i = this.cut(i, this.mathEnd(i));
      else if (char === "`") i = this.cut(i, this.rawEnd(i));
      else if (char === "<" || char === "@") {
        const mark = (char === "<" ? /^<[\w:.-]+>/ : /^@[\w:.-]*\w/).exec(text.slice(i, i + 200))?.[0];
        i = mark === undefined ? i + 1 : this.cut(i, i + mark.length);
      } else if (char === "#" && /[A-Za-z_({[]/.test(text[i + 1] ?? "")) i = this.hashEnd(i);
      else i++;
    }
    return i;
  }

  /** Code after `#`: a keyword line, a block or group, or an identifier chain with its arguments and content. */
  private hashEnd(hash: number): number {
    const text = this.text;
    let i = this.cut(hash, hash + 1);
    const ident = /^[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80))?.[0];
    if (ident !== undefined && TYPST_LINE_KEYWORDS.has(ident)) return this.code(this.cut(i, i + ident.length), "line");
    if (ident === undefined) {
      const open = text[i];
      if (open === "{") return this.code(this.cut(i, i + 1), "}");
      if (open === "(") return this.code(this.cut(i, i + 1), ")");
      this.cut(i, i + 1);
      return this.markup(i + 1, true);
    }
    i = this.cut(i, i + ident.length);
    for (;;) {
      const char = text[i];
      if (char === "(") i = this.code(this.cut(i, i + 1), ")");
      else if (char === "[") { this.cut(i, i + 1); i = this.markup(i + 1, true); }
      else if (char === "." && /^\.[A-Za-z_]/.test(text.slice(i, i + 2))) {
        const member = /^\.[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80))?.[0] ?? ".";
        i = this.cut(i, i + member.length);
      } else return i;
    }
  }

  /** Scans code until its closer (or the line end, unless a bracket stays open); content `[..]` inside is markup. */
  private code(start: number, closer: ")" | "}" | "line"): number {
    const text = this.text;
    const stack: string[] = [];
    let i = start;
    let codeFrom = start;
    while (i < text.length) {
      const char = text[i];
      if (char === "\n" && closer === "line" && stack.length === 0) break;
      if (char === '"') i = this.stringEnd(i);
      else if (char === "/" && text[i + 1] === "/") i = lineEnd(text, i);
      else if (char === "/" && text[i + 1] === "*") i = this.blockCommentEnd(i);
      else if (char === "$") i = this.mathEnd(i);
      else if (char === "`") i = this.rawEnd(i);
      else if (char === "[") {
        this.cut(codeFrom, i + 1);
        i = this.markup(i + 1, true);
        codeFrom = i;
      } else if (char === "(" || char === "{") { stack.push(char === "(" ? ")" : "}"); i++; }
      else if (char === ")" || char === "}") {
        if (stack.length > 0) { stack.pop(); i++; continue; }
        if (char === closer) { i++; break; }
        if (closer === "line") break;
        i++;
      } else i++;
    }
    this.cut(codeFrom, i);
    return i;
  }

  private stringEnd(start: number): number {
    const text = this.text;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"' || text[i] === "\n") return i + 1;
    }
    return text.length;
  }

  private blockCommentEnd(start: number): number {
    const text = this.text;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text.startsWith("/*", i)) { depth++; i++; }
      else if (text.startsWith("*/", i)) { depth--; i++; if (depth === 0) return i + 1; }
    }
    return text.length;
  }

  private mathEnd(start: number): number {
    const text = this.text;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "$") return i + 1;
    }
    return text.length;
  }

  private rawEnd(start: number): number {
    const text = this.text;
    let n = 0;
    while (text[start + n] === "`") n++;
    if (n === 2) return start + 2;
    const fence = "`".repeat(n);
    const at = text.indexOf(fence, start + n);
    return at < 0 ? text.length : at + n;
  }
}
