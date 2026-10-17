// Lists the math symbols the editor's Insert Symbol picker offers, with their LaTeX and Typst source.

export type SymbolCategory = "Greek" | "Operators" | "Relations" | "Arrows" | "Logic and sets" | "Miscellaneous";

export interface MathSymbol {
  glyph: string;
  category: SymbolCategory;
  /** A math-mode command, as the Overleaf symbol palette inserts it. */
  latex: string;
  /** A name under `sym`; `#sym.<name>` works in Typst markup and math alike. */
  typst: string;
}

type Row = readonly [glyph: string, latex: string, typst: string];

const ROWS: Record<SymbolCategory, readonly Row[]> = {
  Greek: [
    ["α", "\\alpha", "alpha"], ["β", "\\beta", "beta"], ["γ", "\\gamma", "gamma"], ["δ", "\\delta", "delta"],
    ["ε", "\\varepsilon", "epsilon"], ["ζ", "\\zeta", "zeta"], ["η", "\\eta", "eta"], ["θ", "\\theta", "theta"],
    ["κ", "\\kappa", "kappa"], ["λ", "\\lambda", "lambda"], ["μ", "\\mu", "mu"], ["ν", "\\nu", "nu"],
    ["ξ", "\\xi", "xi"], ["π", "\\pi", "pi"], ["ρ", "\\rho", "rho"], ["σ", "\\sigma", "sigma"],
    ["τ", "\\tau", "tau"], ["φ", "\\varphi", "phi"], ["χ", "\\chi", "chi"], ["ψ", "\\psi", "psi"],
    ["ω", "\\omega", "omega"], ["Γ", "\\Gamma", "Gamma"], ["Δ", "\\Delta", "Delta"], ["Θ", "\\Theta", "Theta"],
    ["Λ", "\\Lambda", "Lambda"], ["Π", "\\Pi", "Pi"], ["Σ", "\\Sigma", "Sigma"], ["Φ", "\\Phi", "Phi"],
    ["Ψ", "\\Psi", "Psi"], ["Ω", "\\Omega", "Omega"],
  ],
  Operators: [
    ["±", "\\pm", "plus.minus"], ["×", "\\times", "times"], ["÷", "\\div", "div"], ["·", "\\cdot", "dot.op"],
    ["∘", "\\circ", "compose"], ["⊕", "\\oplus", "plus.o"], ["⊗", "\\otimes", "times.o"],
    ["∑", "\\sum", "sum"], ["∏", "\\prod", "product"], ["∫", "\\int", "integral"], ["∮", "\\oint", "integral.cont"],
    ["∂", "\\partial", "partial"], ["∇", "\\nabla", "nabla"], ["∞", "\\infty", "infinity"],
  ],
  Relations: [
    ["≤", "\\leq", "lt.eq"], ["≥", "\\geq", "gt.eq"], ["≠", "\\neq", "eq.not"], ["≈", "\\approx", "approx"],
    ["≡", "\\equiv", "equiv"], ["∼", "\\sim", "tilde.op"], ["∝", "\\propto", "prop"], ["≪", "\\ll", "lt.double"],
    ["≫", "\\gg", "gt.double"], ["⊥", "\\perp", "perp"], ["∥", "\\parallel", "parallel"],
  ],
  Arrows: [
    ["→", "\\rightarrow", "arrow.r"], ["←", "\\leftarrow", "arrow.l"], ["↔", "\\leftrightarrow", "arrow.l.r"],
    ["⇒", "\\Rightarrow", "arrow.r.double"], ["⇐", "\\Leftarrow", "arrow.l.double"],
    ["⇔", "\\Leftrightarrow", "arrow.l.r.double"], ["↦", "\\mapsto", "arrow.r.bar"],
    ["↑", "\\uparrow", "arrow.t"], ["↓", "\\downarrow", "arrow.b"],
  ],
  "Logic and sets": [
    ["∀", "\\forall", "forall"], ["∃", "\\exists", "exists"], ["¬", "\\neg", "not"], ["∧", "\\wedge", "and"],
    ["∨", "\\vee", "or"], ["∈", "\\in", "in"], ["∉", "\\notin", "in.not"], ["⊂", "\\subset", "subset"],
    ["⊆", "\\subseteq", "subset.eq"], ["⊃", "\\supset", "supset"], ["∪", "\\cup", "union"], ["∩", "\\cap", "inter"],
    ["∅", "\\emptyset", "emptyset"], ["ℕ", "\\mathbb{N}", "NN"], ["ℤ", "\\mathbb{Z}", "ZZ"], ["ℚ", "\\mathbb{Q}", "QQ"],
    ["ℝ", "\\mathbb{R}", "RR"], ["ℂ", "\\mathbb{C}", "CC"],
  ],
  Miscellaneous: [
    ["…", "\\ldots", "dots.h"], ["ℓ", "\\ell", "ell"], ["†", "\\dagger", "dagger"], ["′", "\\prime", "prime"],
    ["°", "^\\circ", "degree"],
  ],
};

export const MATH_SYMBOLS: readonly MathSymbol[] = (Object.keys(ROWS) as SymbolCategory[]).flatMap((category) =>
  ROWS[category].map(([glyph, latex, typst]) => ({ glyph, category, latex, typst })));

/** The source text that inserts the symbol in a file of the language. */
export function symbolSource(symbol: MathSymbol, language: "latex" | "typst"): string {
  return language === "latex" ? symbol.latex : `#sym.${symbol.typst}`;
}
