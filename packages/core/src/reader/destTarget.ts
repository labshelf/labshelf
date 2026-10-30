// Classifies a link destination or the text that ends at a link into what it points at. Pure: strings in, a target out.
import { FIGURE_WORD, FLOAT_LABEL, deriveFloatKind, type FloatKind } from "./inTextReferences.js";

export type DestTarget = { kind: "statement" } | { kind: "float"; floatKind: FloatKind; label: string | null };

export interface PageLayout { width: number; height: number; columnSplit: number | null }

/** Destination as PDF user space (y up); x is null when the destination does not fix a horizontal position. */
export interface DestPoint { x: number | null; y: number }

const STATEMENT_NAME_WORDS = new Set([
  "theorem", "thm", "lemma", "lem", "proposition", "prop", "corollary", "cor", "definition", "defn", "def", "remark", "rem",
  "conjecture", "conj", "claim", "example", "exercise", "problem", "assumption", "hypothesis", "notation", "observation",
  "fact", "question", "property",
]);
const FLOAT_NAME_WORDS = new Map<string, FloatKind>([
  ["figure", "figure"], ["subfigure", "figure"],
  ["table", "table"], ["subtable", "table"],
  ["equation", "equation"], ["eq", "equation"], ["ams", "equation"],
]);
const FLOAT_LABEL_EXACT = new RegExp(`^${FLOAT_LABEL}$`);

/**
 * @returns what a named destination ("theorem.2.1", "figure.3") points at, or null for anything else.
 */
export function classifyDestName(name: string): DestTarget | null {
  const lower = name.toLowerCase();
  const sep = lower.search(/[.:]/);
  const head = sep < 0 ? lower : lower.slice(0, sep);
  if (STATEMENT_NAME_WORDS.has(head)) { return { kind: "statement" }; }
  const floatKind = FLOAT_NAME_WORDS.get(head);
  if (!floatKind) { return null; }
  const rest = sep < 0 ? "" : lower.slice(sep + 1);
  return { kind: "float", floatKind, label: FLOAT_LABEL_EXACT.test(rest) ? rest : null };
}

/** The statement words (English and Portuguese) that open a theorem-like heading or end a link's text. */
export const STATEMENT_WORDS_FULL =
  "theorem|lemma|proposition|corollary|definition|remark|conjecture|claim|example|exercise|problem|assumption|hypothesis|notation|observation|fact|question|property|" +
  "teorema|lema|proposição|corolário|definição|observação|exemplo";
const NOT_AFTER_LETTER = "(?<![\\p{L}\\d])";
const STATEMENT_LINK_END = new RegExp(
  `${NOT_AFTER_LETTER}(?:(?:${STATEMENT_WORDS_FULL})s?|(?:thm|lem|prop|cor|defn|def)s?\\.?)\\.?\\s*${FLOAT_LABEL}\\s*$`,
  "iu",
);
const FIGURE_TABLE_LINK_END = new RegExp(
  `${NOT_AFTER_LETTER}(${FIGURE_WORD}|Tab(?:le|ela|la)?s?)\\s*\\.?\\s*\\(?\\s*(${FLOAT_LABEL})\\s*\\)?\\s*$`,
  "iu",
);
const EQUATION_LINK_END = new RegExp(
  `${NOT_AFTER_LETTER}Eq(?:uation|ua[çc][ãa]o|ua[çc][õo]es|uaci[óo]n)?s?\\s*\\.?\\s*(?:\\(\\s*(${FLOAT_LABEL})\\s*\\)|(${FLOAT_LABEL}))?\\s*$`,
  "iu",
);
const BARE_LABEL_LINK_END = new RegExp(`\\(\\s*(${FLOAT_LABEL})\\s*\\)\\s*$`, "iu");

/**
 * @param text the visual line up to the end of the link; only its end is read.
 * @returns what the text that ends at the link says it refers to ("by Theorem 2.1", "Fig. 4", "(3.1)"), or null.
 */
export function classifyLinkText(text: string): DestTarget | null {
  // Punctuation after the link ("Theorem 1.2.", "(see Fig. 3)") is not part of it; "(3.1)" keeps its parenthesis.
  for (let t = text.trimEnd(); t; t = t.slice(0, -1).trimEnd()) {
    const target = classifyLinkTextEnd(t);
    if (target || !TRAILING_PUNCTUATION.test(t)) { return target; }
  }
  return null;
}

const TRAILING_PUNCTUATION = /[.,;:)]$/;

function classifyLinkTextEnd(text: string): DestTarget | null {
  if (STATEMENT_LINK_END.test(text)) { return { kind: "statement" }; }
  const fig = FIGURE_TABLE_LINK_END.exec(text);
  if (fig) { return { kind: "float", floatKind: deriveFloatKind(fig[1]!), label: fig[2]!.toLowerCase() }; }
  const eq = EQUATION_LINK_END.exec(text);
  if (eq) { return { kind: "float", floatKind: "equation", label: (eq[1] ?? eq[2])?.toLowerCase() ?? null }; }
  const bare = BARE_LABEL_LINK_END.exec(text);
  if (bare) { return { kind: "float", floatKind: "equation", label: bare[1]!.toLowerCase() }; }
  return null;
}
