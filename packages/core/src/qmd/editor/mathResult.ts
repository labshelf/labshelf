// Reads and writes the inline result span `[$tex$]{.labshelf-result engine=… source=…}` of a paragraph.
// CONTRACT: documents/contracts/qmd-items.md#inline-results

const RESULT_CLASS = "labshelf-result";

export interface MathResult {
  readonly tex: string;
  readonly engine: string;
  readonly source: string;
}

/** The two attribute values: one or more characters that need no quoting inside `{…}`. */
const VALUE = "[^\\s{}\\[\\]\"'=$]+";
const ATTRIBUTES = new RegExp(`\\]\\{\\.${RESULT_CLASS} engine=(${VALUE}) source=(${VALUE})\\}`, "y");
const VALUE_ONLY = new RegExp(`^${VALUE}$`);

type MatchMath = (source: string, at: number, end: number) => { tex: string; end: number } | null;

/** Reads the span at `at` (a `[`); null when anything is missing, unknown or doubled, so the bytes stay text. */
export function matchMathResult(source: string, at: number, end: number, matchMath: MatchMath): (MathResult & { end: number }) | null {
  if (source[at] !== "[" || source[at + 1] !== "$") return null;
  const math = matchMath(source, at + 1, end);
  if (!math || math.tex.includes("]")) return null;
  ATTRIBUTES.lastIndex = math.end;
  const attributes = ATTRIBUTES.exec(source);
  if (!attributes || ATTRIBUTES.lastIndex > end) return null;
  return { tex: math.tex, engine: attributes[1]!, source: attributes[2]!, end: ATTRIBUTES.lastIndex };
}

/** True when `tex` can stand between the dollar signs of a span: not empty, and without `$`, `]` or a line ending. */
export function isWritableResultTex(tex: string): boolean {
  return tex !== "" && !/[$\]\r\n]/.test(tex);
}

/** Writes the span. Throws when the result would not read back as one span; the view shows `isWritableResultTex` as an error. */
export function formatMathResult(result: MathResult): string {
  if (!isWritableResultTex(result.tex)) throw new RangeError("formatMathResult: the LaTeX holds `$`, `]` or a line ending, or is empty");
  if (!VALUE_ONLY.test(result.engine) || !VALUE_ONLY.test(result.source)) throw new RangeError("formatMathResult: engine and source must be non-empty words");
  return `[$${result.tex}$]{.${RESULT_CLASS} engine=${result.engine} source=${result.source}}`;
}
