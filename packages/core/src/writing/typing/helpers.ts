// Names the source editor's typing helpers (auto-closed math, brackets and quotes, wrapping, Enter and Backspace pairs), what each does and which language it applies to.

/** The languages the typing helpers know; a `.typ` file is Typst, any other source file LaTeX. */
export type TypingLanguage = "latex" | "typst";

export const TYPING_HELPER_IDS = [
  "mathDollar", "mathDelimiters", "brackets", "leftRight", "quotes", "overtype", "deletePair", "enterMath", "wrapSelection", "boldItalic", "scripts", "beginEnd",
] as const;

export type TypingHelperId = (typeof TYPING_HELPER_IDS)[number];

/** Which helpers are on; every id is present. */
export type TypingHelpers = Readonly<Record<TypingHelperId, boolean>>;

export const DEFAULT_TYPING_HELPERS: TypingHelpers = Object.freeze(
  Object.fromEntries(TYPING_HELPER_IDS.map((id) => [id, true])) as Record<TypingHelperId, boolean>,
);

export interface TypingHelperInfo {
  label: string;
  /** The languages the helper acts in; the dialog lists it only for these. */
  languages: readonly TypingLanguage[];
  /** A short example per language, `|` standing for the cursor. */
  examples: Readonly<Partial<Record<TypingLanguage, string>>>;
}

const BOTH: readonly TypingLanguage[] = ["latex", "typst"];
const LATEX: readonly TypingLanguage[] = ["latex"];

export const TYPING_HELPER_INFO: Readonly<Record<TypingHelperId, TypingHelperInfo>> = {
  mathDollar: { label: "Close math with $", languages: BOTH, examples: { latex: "$ → $|$, again → $$|$$", typst: "$ → $|$, Space → $ | $" } },
  mathDelimiters: { label: "Close \\( and \\[", languages: LATEX, examples: { latex: "\\( → \\(|\\)" } },
  brackets: { label: "Close brackets", languages: BOTH, examples: { latex: "( → (|), \\{ → \\{|\\}", typst: "( → (|)" } },
  leftRight: { label: "Close \\left with \\right", languages: LATEX, examples: { latex: "\\left( → \\left(|\\right)" } },
  quotes: { label: "Close quotes", languages: BOTH, examples: { latex: "`` → ``|''", typst: "\" → \"|\"" } },
  overtype: { label: "Type over closing characters", languages: BOTH, examples: { latex: "(x|) + ) → (x)|", typst: "(x|) + ) → (x)|" } },
  deletePair: { label: "Delete empty pairs", languages: BOTH, examples: { latex: "(|) + Backspace → |", typst: "(|) + Backspace → |" } },
  enterMath: { label: "Split display math on Enter", languages: BOTH, examples: { latex: "\\[|\\] + Enter → three lines", typst: "$ | $ + Enter → three lines" } },
  wrapSelection: { label: "Wrap the selection", languages: BOTH, examples: { latex: "select x, $ → $x$", typst: "select x, * → *x*" } },
  boldItalic: { label: "Bold and italic keys", languages: BOTH, examples: { latex: "Mod-B → \\textbf{|}", typst: "Mod-B → *|*" } },
  scripts: { label: "Brace superscripts and subscripts", languages: BOTH, examples: { latex: "^ in math → ^{|}", typst: "^ in math → ^(|)" } },
  beginEnd: { label: "Close environments on Enter", languages: LATEX, examples: { latex: "\\begin{x} + Enter → \\end{x}" } },
};

/** The helpers that act in `language`, in the dialog's order. */
export function listTypingHelpers(language: TypingLanguage): TypingHelperId[] {
  return TYPING_HELPER_IDS.filter((id) => TYPING_HELPER_INFO[id].languages.includes(language));
}

/** Whether two settings have the same switches. */
export function isSameTypingHelpers(a: TypingHelpers, b: TypingHelpers): boolean {
  return TYPING_HELPER_IDS.every((id) => a[id] === b[id]);
}

/** The switches in `value` when it is an object with every helper a boolean; unknown keys are dropped, anything else is undefined. */
export function parseTypingHelpers(value: unknown): TypingHelpers | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { return undefined; }
  const record = value as Record<string, unknown>;
  const typing: Record<string, boolean> = {};
  for (const id of TYPING_HELPER_IDS) {
    const on = record[id];
    if (typeof on !== "boolean") { return undefined; }
    typing[id] = on;
  }
  return typing as TypingHelpers;
}
