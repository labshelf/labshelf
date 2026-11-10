/** Writes a code listing with its link comments into LaTeX or Typst, and finds the listings a manuscript already has with the code each one holds. */
// CONTRACT: documents/contracts/library-format.md#code-listings
import type { LatexRange } from "../../latex/index.js";
import type { CodeLanguage } from "./codeLanguages.js";
import { normalizeCode } from "./codeLanguages.js";
import { formatCodeLinkBegin, formatCodeLinkEnd, isCodeLinkEnd, parseCodeLinkBegin, type CodeLinkRef, type ManuscriptFormat } from "./codeSyntax.js";

/** The LaTeX listing environment a project uses: minted when it loads minted, else listings. */
export type ListingStyle = "minted" | "listings";

export interface ListingChoice {
  style: ListingStyle;
  /** True when no given text loads the package the style needs, so the user has to add it. */
  needsPackage: boolean;
}

const USES = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/** The style from the packages the given texts load (the manuscript and its project's main files); minted wins over listings. */
export function deriveListingStyle(texts: readonly string[]): ListingChoice {
  const packages = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(USES)) {
      for (const name of match[1]!.split(",")) { packages.add(name.trim()); }
    }
  }
  if (packages.has("minted")) { return { style: "minted", needsPackage: false }; }
  return { style: "listings", needsPackage: !packages.has("listings") };
}

/** A copied listing in a manuscript: its link, where its comments are and the code between its environment lines. */
export interface ManuscriptCodeLink extends CodeLinkRef {
  /** 0-based lines of the opening and closing comments. */
  beginLine: number;
  endLine: number;
  /** 0-based lines of the environment's opening and closing lines; undefined when the listing has none between the comments. */
  envBeginLine: number | undefined;
  envEndLine: number | undefined;
  /** The code as written in the manuscript, normalised. */
  code: string;
}

const LATEX_ENV_BEGIN = /^\s*\\begin\{/;
const LATEX_ENV_END = /^\s*\\end\{/;
const FENCE = /^\s*(`{3,})/;

/** Every listing whose comments are well formed, in document order. */
export function scanCodeLinks(format: ManuscriptFormat, text: string): ManuscriptCodeLink[] {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const links: ManuscriptCodeLink[] = [];
  for (let line = 0; line < lines.length; line++) {
    const ref = parseCodeLinkBegin(lines[line]!);
    if (!ref) { continue; }
    let close = line + 1;
    while (close < lines.length && !isCodeLinkEnd(lines[close]!) && !parseCodeLinkBegin(lines[close]!)) { close++; }
    if (close >= lines.length || !isCodeLinkEnd(lines[close]!)) { continue; }
    const env = findEnvironment(format, lines, line + 1, close - 1);
    const code = env ? lines.slice(env.begin + 1, env.end).join("\n") : lines.slice(line + 1, close).join("\n");
    links.push({ ...ref, beginLine: line, endLine: close, envBeginLine: env?.begin, envEndLine: env?.end, code: normalizeCode(code) });
    line = close;
  }
  return links;
}

/** The first opening and the last closing environment line between `from` and `to`, inclusive. */
function findEnvironment(format: ManuscriptFormat, lines: readonly string[], from: number, to: number): { begin: number; end: number } | undefined {
  let begin = -1;
  for (let line = from; line <= to; line++) {
    if (format === "latex" ? LATEX_ENV_BEGIN.test(lines[line]!) : FENCE.test(lines[line]!)) { begin = line; break; }
  }
  if (begin < 0) { return undefined; }
  const fence = format === "typst" ? FENCE.exec(lines[begin]!)![1]! : "";
  for (let line = to; line > begin; line--) {
    const text = lines[line]!;
    if (format === "latex" ? LATEX_ENV_END.test(text) : text.trim() === fence) { return { begin, end: line }; }
  }
  return undefined;
}

export interface ListingSpec {
  format: ManuscriptFormat;
  /** LaTeX only. */
  style: ListingStyle;
  language: CodeLanguage | undefined;
  ref: CodeLinkRef;
  /** Normalised code. */
  code: string;
}

/** The environment's opening and closing lines. Throws when the code holds the line that would close it. */
function buildListingEnvironment({ format, style, language, code }: Omit<ListingSpec, "ref">): { open: string; close: string } {
  if (format === "typst") {
    const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return { open: `${fence}${language?.lexer ?? ""}`, close: fence };
  }
  const name = style === "minted" ? "minted" : "lstlisting";
  if (code.includes(`\\end{${name}}`)) { throw new Error(`The code contains \\end{${name}}, which would end the listing early`); }
  if (style === "minted") { return { open: `\\begin{minted}{${language?.lexer ?? "text"}}`, close: "\\end{minted}" }; }
  return { open: `\\begin{lstlisting}${language?.listings ? `[language=${language.listings}]` : ""}`, close: "\\end{lstlisting}" };
}

/** The whole listing, comments included, with LF line breaks. */
export function buildListing(spec: ListingSpec): string {
  const { open, close } = buildListingEnvironment(spec);
  return [formatCodeLinkBegin(spec.format, spec.ref), open, spec.code, close, formatCodeLinkEnd(spec.format)].join("\n");
}

/**
 * The edit that brings a listing up to date: a new opening comment and new code, keeping the environment lines the user may have changed.
 * Undefined when the listing has no environment lines to keep.
 */
export function buildListingUpdate(format: ManuscriptFormat, text: string, link: ManuscriptCodeLink, ref: CodeLinkRef, code: string): { range: LatexRange; text: string } | undefined {
  if (link.envBeginLine === undefined || link.envEndLine === undefined) { return undefined; }
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const between = lines.slice(link.beginLine + 1, link.envBeginLine + 1);
  if (format === "latex") {
    const name = /\\begin\{([^}]*)\}/.exec(lines[link.envBeginLine]!)?.[1];
    if (name && code.includes(`\\end{${name}}`)) { throw new Error(`The code contains \\end{${name}}, which would end the listing early`); }
  } else {
    const fence = FENCE.exec(lines[link.envBeginLine]!)![1]!;
    if (code.includes(fence)) { throw new Error("The code contains a run of backticks as long as the listing's fence, which would end it early"); }
  }
  return {
    range: { start: { line: link.beginLine, character: 0 }, end: { line: link.envEndLine, character: 0 } },
    text: `${[formatCodeLinkBegin(format, ref), ...between, code].join("\n")}\n`,
  };
}
