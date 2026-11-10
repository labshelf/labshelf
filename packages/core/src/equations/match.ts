/**
 * Picks the source equation a box on the page shows. An equation number in parentheses wins when
 * exactly one equation carries it; otherwise the box text and each equation's expanded LaTeX are reduced to
 * multisets of tokens (letters, digits, operators, Greek letters and math symbols as names) and compared.
 * A named operator (\log, \exp, \max) counts as the letters it prints, since the page text has them one by one.
 * The best text match needs a score of at least 0.6 and a lead of 0.1 over the runner-up. A smaller lead
 * is settled by token order: averaging each score with the same comparison on adjacent token pairs, the
 * best must still lead every equation within 0.1 of it by 0.1. A box that follows one equation's order
 * wins over a neighbour with the same symbols in another order, while near-identical equations, which
 * share almost all their pairs too, still give no match. When every equation within 0.1 of the best has
 * the same LaTeX (a display printed twice; compared without spacing and empty `^{}` or `_{}`), that LaTeX
 * is the answer but not which one: the match is `sameLatex`, and its equation's number and label do not
 * belong to the box.
 */
import type { SourceEquation } from "./enumerate.js";

/** `sameLatex`: the box shows one of several equations with this LaTeX; its number and label are unknown. */
export interface EquationMatch { equation: SourceEquation; by: 'number' | 'text' | 'sameLatex'; score: number }

const MIN_SCORE = 0.6;
const MIN_LEAD = 0.1;
const EPSILON = 1e-9;

/** `(4)`, `( 3a )`, `(2.3)`, `(A.1)`: an equation number token in the box text. */
const NUMBER_TOKEN = /\(\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*[a-z]?)\s*\)/g;

export function matchEquation(boxText: string, equations: SourceEquation[]): EquationMatch | undefined {
  if (boxText.trim() === "" || equations.length === 0) return undefined;
  const numbers = [...boxText.matchAll(NUMBER_TOKEN)].map((match) => match[1] ?? "");
  for (const number of numbers.reverse()) {
    const carriers = equations.filter((equation) => equation.numbers.includes(number));
    const [only] = carriers;
    if (carriers.length === 1 && only !== undefined) return { equation: only, by: "number", score: 1 };
  }
  const boxTokens = boxTextTokens(boxText.replace(NUMBER_TOKEN, " "));
  if (boxTokens.length === 0) return undefined;
  const scored = equations
    .map((equation) => {
      const tokens = latexTokens(equation.latex);
      return { equation, tokens, score: similarity(boxTokens, tokens) };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best === undefined || best.score < MIN_SCORE - EPSILON) return undefined;
  if (second !== undefined && best.score - second.score < MIN_LEAD - EPSILON && !orderSettles(boxTokens, scored)) {
    const latex = normalizedLatex(best.equation);
    const window = scored.filter((entry) => best.score - entry.score < MIN_LEAD - EPSILON);
    if (window.every((entry) => normalizedLatex(entry.equation) === latex)) return { equation: best.equation, by: "sameLatex", score: best.score };
    return undefined;
  }
  return { equation: best.equation, by: "text", score: best.score };
}

/**
 * Whether token order settles a near tie: the best is strictly ahead on tokens and, with each score
 * averaged with its similarity on adjacent token pairs, leads every equation within MIN_LEAD of it by MIN_LEAD.
 */
function orderSettles(boxTokens: readonly string[], scored: ReadonlyArray<{ tokens: string[]; score: number }>): boolean {
  const [best, ...rest] = scored;
  if (best === undefined) return false;
  const boxPairs = pairs(boxTokens);
  const withOrder = (entry: { tokens: string[]; score: number }): number => (entry.score + similarity(boxPairs, pairs(entry.tokens))) / 2;
  const bestWithOrder = withOrder(best);
  for (const other of rest) {
    if (best.score - other.score >= MIN_LEAD - EPSILON) break;
    if (best.score - other.score < EPSILON) return false;
    if (bestWithOrder - withOrder(other) < MIN_LEAD - EPSILON) return false;
  }
  return true;
}

/**
 * The LaTeX without what prints nothing: empty superscripts and subscripts, and spaces except the one that
 * ends a control word before a letter.
 */
function normalizedLatex(equation: SourceEquation): string {
  const latex = equation.latex.replace(/[\^_]\s*\{\s*\}/g, "").trim();
  return latex.replace(/\s+/g, (_space, at: number) => {
    const endsControlWord = /\\[A-Za-z]+$/.test(latex.slice(Math.max(0, at - 64), at));
    return endsControlWord && /[A-Za-z]/.test(latex[at + _space.length] ?? "") ? " " : "";
  });
}

/** Adjacent token pairs, in order. */
function pairs(tokens: readonly string[]): string[] {
  return tokens.slice(1).map((token, i) => `${tokens[i]} ${token}`);
}

/** Dice coefficient of two token multisets. */
function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length + b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of b) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of a) {
    const left = counts.get(token) ?? 0;
    if (left > 0) {
      shared++;
      counts.set(token, left - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ι: "iota",
  κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", ο: "o", π: "pi", ρ: "rho", σ: "sigma", ς: "sigma",
  τ: "tau", υ: "upsilon", φ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Σ: "Sigma", Υ: "Upsilon", Φ: "Phi",
  Ψ: "Psi", Ω: "Omega", ϑ: "theta", ϖ: "pi", ϱ: "rho", ϰ: "kappa",
};

const SYMBOLS: Record<string, string> = {
  "∂": "partial", "∇": "nabla", "∑": "sum", "∏": "prod", "∐": "coprod", "∫": "int", "∬": "iint", "∭": "iiint",
  "∮": "oint", "∞": "infty", "≈": "approx", "≤": "leq", "≥": "geq", "≠": "neq", "±": "pm", "∓": "mp",
  "×": "times", "·": "cdot", "⋅": "cdot", "∘": "circ", "→": "to", "←": "leftarrow", "↦": "mapsto",
  "⇒": "Rightarrow", "⇐": "Leftarrow", "⇔": "Leftrightarrow", "↔": "leftrightarrow", "∈": "in", "∉": "notin",
  "∋": "ni", "⊂": "subset", "⊃": "supset", "⊆": "subseteq", "⊇": "supseteq", "∪": "cup", "∩": "cap",
  "∀": "forall", "∃": "exists", "¬": "neg", "∧": "wedge", "∨": "vee", "√": "sqrt", "≡": "equiv", "∼": "sim",
  "≃": "simeq", "≅": "cong", "∝": "propto", "⊗": "otimes", "⊕": "oplus", "ℏ": "hbar", "ℓ": "ell",
  "′": "prime", "…": "ldots", "⋯": "cdots", "⟨": "langle", "⟩": "rangle", "∅": "emptyset", "≪": "ll",
  "≫": "gg", "⊥": "perp", "∥": "parallel", "†": "dagger", "∗": "ast", "÷": "div", "ℜ": "Re", "ℑ": "Im",
  "−": "-", "–": "-", "<": "<", ">": ">", "=": "=", "+": "+", "-": "-", "/": "/", "!": "!", "'": "prime",
};

/** TeX command names that print the same glyph as another name. */
const ALIASES: Record<string, string> = {
  varepsilon: "epsilon", vartheta: "theta", varphi: "phi", varpi: "pi", varrho: "rho", varsigma: "sigma",
  varkappa: "kappa", le: "leq", leqslant: "leq", ge: "geq", geqslant: "geq", ne: "neq", rightarrow: "to",
  gets: "leftarrow", implies: "Rightarrow", iff: "Leftrightarrow", dots: "ldots", dotsc: "ldots",
  dotsb: "cdots", land: "wedge", lor: "vee", lnot: "neg", lbrace: "", rbrace: "", vert: "", lvert: "",
  rvert: "", Vert: "parallel", lVert: "parallel", rVert: "parallel", colon: "", mid: "",
};

/** Commands that print nothing of their own: spacing, grouping, sizing and font switches. */
const DROPPED = new Set([
  ",", ";", ":", "!", " ", ">", "quad", "qquad", "enspace", "thinspace", "medspace", "thickspace", "negthinspace",
  "left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr",
  "Biggl", "Biggr", "frac", "dfrac", "tfrac", "cfrac", "binom", "displaystyle", "textstyle", "scriptstyle",
  "scriptscriptstyle", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak",
  "mathscr", "boldsymbol", "bm", "rm", "bf", "it", "cal", "text", "textrm", "textbf", "textit", "mbox",
  "operatorname", "limits", "nolimits", "nonumber", "notag", "hat", "bar", "tilde", "vec", "dot", "ddot",
  "widehat", "widetilde", "overline", "underline", "mathop", "mathrel", "mathbin", "phantom", "{", "}",
  "\\", "&", "cr", "lbrack", "rbrack",
]);

/** Operators that print their name in upright letters; the page text gives those letters one by one. */
const OPERATOR_NAMES = new Set([
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc", "deg", "det", "dim", "exp", "gcd",
  "hom", "inf", "ker", "lg", "lim", "liminf", "limsup", "ln", "log", "max", "min", "Pr", "sec", "sin", "sinh",
  "sup", "tan", "tanh",
]);

/** Commands whose braced argument is not printed. */
const SKIP_ARGUMENT = new Set(["begin", "end", "label", "tag", "hspace", "vspace", "hphantom", "vphantom", "eqref", "ref"]);
/** Environments whose begin carries a second, column argument. */
const COLUMN_ENVIRONMENTS = new Set(["array", "alignat", "alignat*", "alignedat", "tabular"]);

function boxTextTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const char of text.normalize("NFKC")) {
    const token = charToken(char);
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

/** A letter or digit as itself, a Greek letter or math symbol as its name, anything else undefined. */
function charToken(char: string): string | undefined {
  if (/^[A-Za-z0-9]$/.test(char)) return char;
  return GREEK[char] ?? SYMBOLS[char];
}

function latexTokens(latex: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < latex.length) {
    const char = latex[i] ?? "";
    if (char === "\\") {
      const letters = /^[A-Za-z]+/.exec(latex.slice(i + 1));
      const name = letters?.[0] ?? latex[i + 1] ?? "";
      i += 1 + Math.max(name.length, 1);
      if (SKIP_ARGUMENT.has(name)) {
        const argument = readArgument(latex, i);
        i = argument.end;
        if (name === "begin" && COLUMN_ENVIRONMENTS.has(argument.text)) i = readArgument(latex, i).end;
        continue;
      }
      if (OPERATOR_NAMES.has(name)) {
        tokens.push(...name);
        continue;
      }
      const token = commandToken(name);
      if (token !== "") tokens.push(token);
      continue;
    }
    i++;
    const token = charToken(char);
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

function commandToken(name: string): string {
  if (DROPPED.has(name)) return "";
  const alias = ALIASES[name];
  if (alias !== undefined) return alias;
  if (name === "|") return "parallel";
  if (name === "{" || name === "}") return "";
  if (!/^[A-Za-z]+$/.test(name)) return "";
  return name;
}

/** Reads a braced argument (or a single character) after optional spaces. */
function readArgument(latex: string, start: number): { text: string; end: number } {
  let i = start;
  while (i < latex.length && /\s/.test(latex[i] ?? "")) i++;
  if (latex[i] !== "{") return { text: "", end: i };
  let depth = 0;
  for (let j = i; j < latex.length; j++) {
    if (latex[j] === "\\") {
      j++;
      continue;
    }
    if (latex[j] === "{") depth++;
    else if (latex[j] === "}" && --depth === 0) return { text: latex.slice(i + 1, j), end: j + 1 };
  }
  return { text: latex.slice(i + 1), end: latex.length };
}
