// Tests the function-expression parser (decision D9): plain math and LaTeX forms parse to an AST and evaluate without eval, errors name the first unexpected token at its offset; the syntax half of acceptance A6.
import { parseExpr } from "../../../src/qmd/drawing/expr";

function ev(source: string, x: number): number {
  const result = parseExpr(source);
  if (!result.ok) { throw new Error(`"${source}" did not parse: ${result.error} at ${result.at}`); }
  return result.evaluate(x);
}

function fail(source: string) {
  const result = parseExpr(source);
  if (result.ok) { throw new Error(`"${source}" parsed but should not`); }
  return result;
}

describe("A6 plain math syntax", () => {
  it.each([
    ["2x^2 - 1", 3, 17],
    ["3x + 2", 2, 8],
    ["sin(x)/x", 2, Math.sin(2) / 2],
    ["exp(-x^2)", 1, Math.exp(-1)],
    ["abs(x)", -3, 3],
    ["2.5*x", 4, 10],
    ["0.5x", 4, 2],
    ["  x  +  1 ", 2, 3],
    ["(x + 1) * (x - 1)", 3, 8],
    ["10 - x", 4, 6],
    ["x", 7, 7],
    ["42", 1, 42],
  ])("A6 evaluates %s at %d", (source, x, expected) => {
    expect(ev(source, x)).toBeCloseTo(expected, 9);
  });

  it("A6 knows pi and e", () => {
    expect(ev("pi", 0)).toBeCloseTo(Math.PI, 12);
    expect(ev("e", 0)).toBeCloseTo(Math.E, 12);
    expect(ev("e^x", 2)).toBeCloseTo(Math.exp(2), 9);
    expect(ev("x*pi", 2)).toBeCloseTo(2 * Math.PI, 9);
  });

  it.each([
    ["sin", 0.7, Math.sin(0.7)],
    ["cos", 0.7, Math.cos(0.7)],
    ["tan", 0.7, Math.tan(0.7)],
    ["asin", 0.5, Math.asin(0.5)],
    ["acos", 0.5, Math.acos(0.5)],
    ["atan", 0.7, Math.atan(0.7)],
    ["sinh", 0.7, Math.sinh(0.7)],
    ["cosh", 0.7, Math.cosh(0.7)],
    ["tanh", 0.7, Math.tanh(0.7)],
    ["exp", 0.7, Math.exp(0.7)],
    ["ln", 2, Math.log(2)],
    ["log", 1000, 3],
    ["sqrt", 2, Math.SQRT2],
    ["abs", -2.5, 2.5],
    ["floor", -1.5, -2],
    ["ceil", -1.5, -1],
  ])("A6 evaluates %s(x) at %d", (name, x, expected) => {
    expect(ev(`${name}(x)`, x)).toBeCloseTo(expected, 9);
  });

  it("A6 takes log as base 10 and ln as natural", () => {
    expect(ev("log(x)", 100)).toBeCloseTo(2, 12);
    expect(ev("ln(x)", Math.E)).toBeCloseTo(1, 12);
  });

  it("A6 yields non-finite numbers outside a function's domain instead of throwing", () => {
    expect(Number.isFinite(ev("sqrt(x)", -1))).toBe(false);
    expect(Number.isFinite(ev("1/x", 0))).toBe(false);
    expect(Number.isFinite(ev("ln(x)", 0))).toBe(false);
  });

  it("A6 evaluates the same parsed expression at several points", () => {
    const result = parseExpr("x^2");
    if (!result.ok) { throw new Error(result.error); }
    expect([result.evaluate(1), result.evaluate(2), result.evaluate(-3), result.evaluate(1)]).toEqual([1, 4, 9, 1]);
  });
});

describe("A6 precedence", () => {
  it.each([
    ["-x^2", 3, -9],
    ["(-x)^2", 3, 9],
    ["-2^2", 0, -4],
    ["2^3^2", 0, 512],
    ["2x^2", 3, 18],
    ["3x^2", 3, 27],
    ["1 - 2 - 3", 0, -4],
    ["8/2/2", 0, 2],
    ["x/2*3", 4, 6],
    ["2 + 3*4", 0, 14],
    ["-x", 3, -3],
    ["2 - x", 3, -1],
    ["sin(x)^2", 1, Math.sin(1) ** 2],
  ])("A6 evaluates %s at %d", (source, x, expected) => {
    expect(ev(source, x)).toBeCloseTo(expected, 9);
  });
});

describe("A6 implicit multiplication", () => {
  it.each([
    ["2x", 3, 6],
    ["2(x+1)", 3, 8],
    ["x(x+1)", 3, 12],
    ["(x+1)(x-1)", 3, 8],
    ["(x+1)x", 3, 12],
    ["2pi", 0, 2 * Math.PI],
    ["x pi", 2, 2 * Math.PI],
    ["pi x", 2, 2 * Math.PI],
    ["2 sin(x)", 1, 2 * Math.sin(1)],
    ["2sin(x)", 1, 2 * Math.sin(1)],
    ["x sin(x)", 2, 2 * Math.sin(2)],
    ["sin(x)cos(x)", 1, Math.sin(1) * Math.cos(1)],
    ["2 (x + 1)", 3, 8],
    ["2 e", 0, 2 * Math.E],
  ])("A6 evaluates %s at %d", (source, x, expected) => {
    expect(ev(source, x)).toBeCloseTo(expected, 9);
  });
});

describe("A6 LaTeX forms", () => {
  it.each([
    ["\\frac{1}{x}", 4, 0.25],
    ["\\frac{x+1}{x-1}", 3, 2],
    ["\\frac{x^2}{2}", 4, 8],
    ["\\frac{\\sin x}{x}", 2, Math.sin(2) / 2],
    ["\\frac{1}{\\sqrt{x}}", 4, 0.5],
    ["\\sqrt{x}", 9, 3],
    ["\\sqrt{x^2+16}", 3, 5],
    ["\\sin x", 1, Math.sin(1)],
    ["\\sin(x)", 1, Math.sin(1)],
    ["\\cos x + 1", 0, 2],
    ["\\sin x \\cos x", 1, Math.sin(1) * Math.cos(1)],
    ["\\tan x", 0.7, Math.tan(0.7)],
    ["\\ln x", Math.E, 1],
    ["\\pi", 0, Math.PI],
    ["2\\pi x", 1, 2 * Math.PI],
    ["e^{x}", 2, Math.exp(2)],
    ["e^{-x^2}", 1, Math.exp(-1)],
    ["e^{2x}", 1, Math.exp(2)],
    ["x^{2}", 3, 9],
    ["x^{2+1}", 2, 8],
    ["2 \\cdot x", 3, 6],
    ["x \\times 3", 2, 6],
    ["\\left(x+1\\right)^2", 2, 9],
    ["\\left(x+1\\right)\\left(x-1\\right)", 3, 8],
  ])("A6 evaluates %s at %d", (source, x, expected) => {
    expect(ev(source, x)).toBeCloseTo(expected, 9);
  });

  it("A6 gives the same value for a LaTeX form and its plain math twin", () => {
    for (const x of [0.5, 1, 2.5]) {
      expect(ev("\\frac{x+1}{x^2+1}", x)).toBeCloseTo(ev("(x+1)/(x^2+1)", x), 12);
    }
  });
});

describe("A6 errors", () => {
  it("A6 names the first unexpected token and its offset", () => {
    const result = fail("2 + * 3");
    expect(result.at).toBe(4);
    expect(result.error).toContain("*");
  });

  it("A6 reports an unmatched closing parenthesis", () => {
    const result = fail("x + 1)");
    expect(result.at).toBe(5);
    expect(result.error).toContain(")");
  });

  it("A6 reports a character that is not part of the language", () => {
    const result = fail("2 $ x");
    expect(result.at).toBe(2);
    expect(result.error).toContain("$");
  });

  it("A6 rejects a variable other than x, naming it", () => {
    const result = fail("y + 1");
    expect(result.at).toBe(0);
    expect(result.error).toContain("y");
    expect(fail("2 + t").at).toBe(4);
  });

  it("A6 rejects an unknown function, naming it", () => {
    const result = fail("foo(x)");
    expect(result.at).toBe(0);
    expect(result.error).toContain("foo");
  });

  it.each([["an empty string", ""], ["blanks", "   "], ["an operator with no operand", "2 +"], ["an unclosed parenthesis", "sin(x"], ["empty parentheses", "()"]])("A6 rejects %s", (_name, source) => {
    const result = fail(source);
    expect(result.error.length).toBeGreaterThan(0);
    expect(Number.isInteger(result.at)).toBe(true);
    expect(result.at).toBeGreaterThanOrEqual(0);
    expect(result.at).toBeLessThanOrEqual(source.length);
  });

  it("A6 gives the offset in the original LaTeX source, not in the normalised text", () => {
    const source = "\\frac{1}{x} + * 2";
    const result = fail(source);
    expect(result.at).toBe(source.indexOf("*"));
    expect(result.error).toContain("*");
  });

  it("A6 keeps the offset after \\left( and \\right)", () => {
    const source = "\\left(x\\right) + * 2";
    expect(fail(source).at).toBe(source.indexOf("*"));
  });

  it("A6 keeps the offset after a braced exponent", () => {
    const source = "e^{2x} + * 2";
    expect(fail(source).at).toBe(source.indexOf("*"));
  });
});

describe("A6 expressions never reach eval", () => {
  it.each([
    "process.exit(1)",
    "alert(1)",
    "constructor",
    "x.constructor",
    "globalThis",
    "this",
    "__proto__",
    "Math.sin(x)",
    "x; 1",
    "(() => 1)()",
    "require('fs')",
    "`1`",
  ])("A6 rejects the code-like input %s", (source) => {
    expect(parseExpr(source).ok).toBe(false);
  });

  it("A6 parses and evaluates without eval or the Function constructor", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { eval: g.eval, Function: g.Function };
    const trap = () => { throw new Error("eval used"); };
    g.eval = trap;
    g.Function = trap;
    try {
      const values = ["sin(x)/x", "2x^2 - 1", "\\frac{x+1}{x-1}", "e^{-x^2}", "\\sin x \\cos x"].map((source) => ev(source, 2));
      expect(values.every((v) => Number.isFinite(v))).toBe(true);
    } finally {
      g.eval = saved.eval;
      g.Function = saved.Function;
    }
  });
});
