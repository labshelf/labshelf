// Verifies collecting the author's macros and expanding them in LaTeX (plan D6).
import { collectMacros, expandMacros } from "../../src/equations/macros";

const tex = String.raw;

/** Collapses runs of whitespace and trims, so tests do not pin incidental spacing. */
const norm = (text: string): string => text.replace(/\s+/g, " ").trim();

const expand = (definitions: string, latex: string): string => norm(expandMacros(latex, collectMacros(definitions)));

describe("collectMacros", () => {
  it("1.2c finds no macros in a text without definitions", () => {
    expect(collectMacros(tex`\begin{equation} x \end{equation}`).size).toBe(0);
  });

  it("1.2c counts each defined command", () => {
    const table = collectMacros(tex`\newcommand{\a}{1}
\def\b{2}
\let\c\a
\DeclareMathOperator{\d}{d}`);
    expect(table.size).toBe(4);
  });

  it("1.2c collects macros defined after \\begin{document}", () => {
    const definitions = tex`\documentclass{article}
\begin{document}
\newcommand{\late}{L}`;
    expect(expand(definitions, tex`\late`)).toBe("L");
  });
});

describe("expandMacros definitions", () => {
  it("1.2c expands a newcommand without arguments", () => {
    expect(expand(tex`\newcommand{\R}{\mathbb{R}}`, tex`x \in \R^2`)).toBe(String.raw`x \in \mathbb{R}^2`);
  });

  it("1.2c expands a newcommand whose name is not in braces", () => {
    expect(expand(tex`\newcommand\R{\mathbb{R}}`, tex`\R^n`)).toBe(String.raw`\mathbb{R}^n`);
  });

  it("1.2c does not expand a longer command that starts with a macro name", () => {
    expect(expand(tex`\newcommand{\R}{\mathbb{R}}`, tex`a \Rightarrow b`)).toBe(String.raw`a \Rightarrow b`);
  });

  it("1.2c expands a newcommand with one argument", () => {
    expect(expand(tex`\newcommand{\norm}[1]{\left\|#1\right\|}`, tex`\norm{x}`)).toBe(String.raw`\left\|x\right\|`);
  });

  it("1.2c expands a newcommand with two arguments in order", () => {
    expect(expand(tex`\newcommand{\pair}[2]{(#1, #2)}`, tex`\pair{a}{b}`)).toBe("(a, b)");
  });

  it("1.2c uses an argument twice when the body mentions it twice", () => {
    expect(expand(tex`\newcommand{\sq}[1]{#1^2 + #1}`, tex`\sq{z}`)).toBe("z^2 + z");
  });

  it("1.2c reads an argument with nested braces whole", () => {
    expect(expand(tex`\newcommand{\norm}[1]{\left\|#1\right\|}`, tex`\norm{\frac{a}{b}}`)).toBe(String.raw`\left\|\frac{a}{b}\right\|`);
  });

  it("1.2c reads a single-token argument without braces", () => {
    expect(expand(tex`\newcommand{\wh}[1]{\widehat{#1}}`, tex`\wh x`)).toBe(String.raw`\widehat{x}`);
  });

  it("1.2c uses the default of an optional first argument when it is omitted", () => {
    expect(expand(tex`\newcommand{\vecn}[2][n]{x_{#1}^{#2}}`, tex`\vecn{2}`)).toBe("x_{n}^{2}");
  });

  it("1.2c uses the given optional argument instead of the default", () => {
    expect(expand(tex`\newcommand{\vecn}[2][n]{x_{#1}^{#2}}`, tex`\vecn[k]{2}`)).toBe("x_{k}^{2}");
  });

  it("1.2c lets renewcommand replace an earlier definition", () => {
    expect(expand(tex`\newcommand{\a}{one}\renewcommand{\a}{two}`, tex`\a`)).toBe("two");
  });

  it("1.2c uses the last definition when the same command is defined twice", () => {
    expect(expand(tex`\def\a{one}\def\a{three}`, tex`\a`)).toBe("three");
  });

  it("1.2c expands a providecommand", () => {
    expect(expand(tex`\providecommand{\p}{P}`, tex`\p`)).toBe("P");
  });

  it("1.2c expands a def without parameters", () => {
    expect(expand(tex`\def\half{\frac{1}{2}}`, tex`x = \half`)).toBe(String.raw`x = \frac{1}{2}`);
  });

  it("1.2c expands a def with #1#2 parameters", () => {
    expect(expand(tex`\def\swap#1#2{#2#1}`, tex`\swap{a}{b}`)).toBe("ba");
  });

  it("1.2c expands a let alias to the aliased command", () => {
    expect(expand(tex`\let\eps\varepsilon`, tex`\eps > 0`)).toBe(String.raw`\varepsilon > 0`);
  });

  it("1.2c expands a let alias written with an equals sign", () => {
    expect(expand(tex`\let\ph=\varphi`, tex`\ph(x)`)).toBe(String.raw`\varphi(x)`);
  });

  it("1.2c expands DeclareMathOperator to \\operatorname", () => {
    expect(expand(tex`\DeclareMathOperator{\Tr}{Tr}`, tex`\Tr A`)).toMatch(/^\\operatorname\{Tr\}\s*A$/);
  });

  it("1.2c expands the starred DeclareMathOperator to \\operatorname*", () => {
    expect(expand(tex`\DeclareMathOperator*{\argmax}{arg\,max}`, tex`\argmax_x f(x)`)).toBe(String.raw`\operatorname*{arg\,max}_x f(x)`);
  });

  it("1.2c expands macros nested inside other macro bodies", () => {
    expect(expand(tex`\newcommand{\A}{\B + 1}\newcommand{\B}{b}`, tex`\A`)).toBe("b + 1");
  });

  it("1.2c expands a macro passed as an argument of another", () => {
    const definitions = tex`\newcommand{\R}{\mathbb{R}}\newcommand{\norm}[1]{\left\|#1\right\|}`;
    expect(expand(definitions, tex`\norm{\R}`)).toBe(String.raw`\left\|\mathbb{R}\right\|`);
  });

  it("1.2c stops a self-recursive macro and returns the text so far with the unexpanded rest", () => {
    const result = expandMacros(tex`\loop`, collectMacros(tex`\newcommand{\loop}{x\loop}`));
    expect(result).toMatch(/^x+\\loop$/);
    const xs = result.length - String.raw`\loop`.length;
    expect(xs).toBeGreaterThanOrEqual(1);
    expect(xs).toBeLessThanOrEqual(40);
  });

  it("1.2c stops mutually recursive macros", () => {
    const result = expandMacros(tex`\ping`, collectMacros(tex`\newcommand{\ping}{a\pong}\newcommand{\pong}{b\ping}`));
    expect(result.length).toBeLessThan(1000);
    expect(result.startsWith("ab")).toBe(true);
  });
});

describe("expandMacros limits and unknown commands", () => {
  it("A3 leaves unknown commands as they are", () => {
    expect(expand(tex`\newcommand{\R}{\mathbb{R}}`, tex`\frac{\foo{a}}{\bar} + \alpha`)).toBe(String.raw`\frac{\foo{a}}{\bar} + \alpha`);
  });

  it("A3 returns the latex unchanged when the table is empty", () => {
    expect(expandMacros(tex`\frac{a}{b}`, collectMacros(""))).toBe(String.raw`\frac{a}{b}`);
  });

  it("A3 keeps the text around an expanded macro", () => {
    expect(expand(tex`\newcommand{\R}{\mathbb{R}}`, tex`a + \R + b`)).toBe(String.raw`a + \mathbb{R} + b`);
  });

  it("A3 caps the output of an exponentially growing macro at about 64 KiB", () => {
    // Each level doubles the previous one; 26 levels would be 2^25 characters.
    const names = "abcdefghijklmnopqrstuvwxyz".split("").map((letter) => "d" + letter);
    const defs = names.map((name, index) => {
      const previous = names[index - 1];
      return index === 0 || previous === undefined ? "\\newcommand{\\" + name + "}{x}" : "\\newcommand{\\" + name + "}{\\" + previous + "\\" + previous + "}";
    });
    const table = collectMacros(defs.join("\n"));
    const started = Date.now();
    const result = expandMacros("\\" + names[names.length - 1], table);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.length).toBeGreaterThan(1000);
    expect(result.length).toBeLessThanOrEqual(128 * 1024);
  });

  it("A3 does not run past the cap on a macro that doubles its own text", () => {
    const table = collectMacros(tex`\newcommand{\dbl}{\dbl\dbl}`);
    const result = expandMacros(tex`\dbl`, table);
    expect(result.length).toBeLessThanOrEqual(128 * 1024);
    expect(result).toContain(String.raw`\dbl`);
  });
});
