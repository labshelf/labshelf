// Tests the function-expression parser (decision D9): plain math and LaTeX forms parse to an AST and evaluate without eval, errors name the first unexpected token at its offset; the syntax half of acceptance A6.
import { parseExpr } from "../../src/drawing/expr";

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
    "process[\"exit\"](1)",
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

// Session 5.1: several variables per parse, named parameters, more functions, letter runs split into one-letter names, theta.
type Env = Readonly<Record<string, number>>;

function parsed(source: string, options?: { vars?: readonly string[]; params?: readonly string[] }) {
  const result = parseExpr(source, options);
  if (!result.ok) { throw new Error(`"${source}" did not parse: ${result.error} at ${result.at}`); }
  return result;
}

function evAt(source: string, options: { vars?: readonly string[]; params?: readonly string[] } | undefined, x: number, env?: Env): number {
  return parsed(source, options).evaluate(x, env);
}

function failWith(source: string, options?: { vars?: readonly string[]; params?: readonly string[] }) {
  const result = parseExpr(source, options);
  if (result.ok) { throw new Error(`"${source}" parsed but should not`); }
  return result;
}

describe("5.1a several variables and an env", () => {
  it("5.1a evaluates x + y + cos x + sin y with y taken from env", () => {
    const options = { vars: ["x", "y"] };
    expect(evAt("x + y + cos x + sin y", options, 2, { y: 3 })).toBeCloseTo(2 + 3 + Math.cos(2) + Math.sin(3), 9);
  });

  it("5.1a re-evaluates the same parse with different env values", () => {
    const result = parsed("x*y", { vars: ["x", "y"] });
    expect([result.evaluate(2, { y: 3 }), result.evaluate(2, { y: 5 }), result.evaluate(4, { y: 5 })]).toEqual([6, 10, 20]);
  });

  it("5.1a takes the first declared variable as the positional argument", () => {
    expect(evAt("t^2", { vars: ["t"] }, 3)).toBeCloseTo(9, 12);
    expect(evAt("u - v", { vars: ["u", "v"] }, 10, { v: 4 })).toBeCloseTo(6, 12);
  });

  it("5.1a evaluates a declared variable missing from env to NaN", () => {
    expect(Number.isNaN(evAt("x + y", { vars: ["x", "y"] }, 1))).toBe(true);
    expect(Number.isNaN(evAt("x + y", { vars: ["x", "y"] }, 1, {}))).toBe(true);
  });

  it("5.1a leaves 4*sin(x) + 5*cos(x/2) unchanged from the single-variable behaviour", () => {
    for (const x of [-3, 0, 1.5, 7]) {
      const expected = 4 * Math.sin(x) + 5 * Math.cos(x / 2);
      expect(ev("4*sin(x) + 5*cos(x/2)", x)).toBeCloseTo(expected, 12);
      expect(evAt("4*sin(x) + 5*cos(x/2)", undefined, x)).toBeCloseTo(expected, 12);
      expect(evAt("4*sin(x) + 5*cos(x/2)", { vars: ["x"] }, x)).toBeCloseTo(expected, 12);
    }
  });

  it("5.1a ignores an env on a single-variable expression", () => {
    expect(evAt("x^2", undefined, 3, { y: 100 })).toBeCloseTo(9, 12);
  });

  it("5.1a still rejects y when only x is declared", () => {
    const result = failWith("x + y");
    expect(result.at).toBe(4);
    expect(result.error).toContain("y");
  });

  it("5.1a rejects x when it is not among the declared variables", () => {
    const result = failWith("t + x", { vars: ["t"] });
    expect(result.at).toBe(4);
    expect(result.error).toContain("x");
  });

  it("5.1a exposes the AST with a name on each function call", () => {
    const result = parsed("sin(x)");
    expect(result.ast).toMatchObject({ type: "call", name: "sin", args: [{ type: "var", name: "x" }] });
  });

  it("5.1a exposes variables, numbers and operators on the AST", () => {
    const result = parsed("x + 2", { vars: ["x"] });
    expect(result.ast).toMatchObject({ type: "bin", op: "+", left: { type: "var", name: "x" }, right: { type: "num", value: 2 } });
  });

  it("5.1a exposes a negation on the AST", () => {
    expect(parsed("-x").ast).toMatchObject({ type: "neg", arg: { type: "var", name: "x" } });
  });

  it("5.1a exposes every argument of a multi-argument call on the AST", () => {
    const result = parsed("atan2(y, x)", { vars: ["x", "y"] });
    expect(result.ast).toMatchObject({ type: "call", name: "atan2" });
    if (result.ast.type !== "call") { throw new Error("not a call"); }
    expect(result.ast.args).toHaveLength(2);
    expect(result.ast.args[0]).toMatchObject({ type: "var", name: "y" });
    expect(result.ast.args[1]).toMatchObject({ type: "var", name: "x" });
  });
});

describe("5.1b letter runs, parameters and unknown names", () => {
  it("5.1b reads xy as x*y with vars x and y", () => {
    const options = { vars: ["x", "y"] };
    expect(evAt("xy", options, 3, { y: 4 })).toBeCloseTo(12, 12);
    expect(parsed("xy", options).ast).toMatchObject({ type: "bin", op: "*", left: { type: "var", name: "x" }, right: { type: "var", name: "y" } });
  });

  it("5.1b splits longer runs of declared names such as xyx", () => {
    expect(evAt("xyx", { vars: ["x", "y"] }, 2, { y: 5 })).toBeCloseTo(20, 12);
  });

  it("5.1b splits a run mixed with a number and a power, 2xy^2", () => {
    expect(evAt("2xy^2", { vars: ["x", "y"] }, 3, { y: 2 })).toBeCloseTo(24, 12);
  });

  it("5.1b reads a x^2 with parameter a as a*x^2", () => {
    const options = { params: ["a"] };
    expect(evAt("a x^2", options, 3, { a: 2 })).toBeCloseTo(18, 12);
    expect(evAt("a x^2", options, 3, { a: -1 })).toBeCloseTo(-9, 12);
  });

  it("5.1b reads ax with parameter a as a*x", () => {
    expect(evAt("ax", { params: ["a"] }, 4, { a: 3 })).toBeCloseTo(12, 12);
  });

  it("5.1b evaluates a parameter missing from env to NaN", () => {
    expect(Number.isNaN(evAt("a*x", { params: ["a"] }, 4))).toBe(true);
  });

  it("5.1b combines variables and parameters", () => {
    const options = { vars: ["x", "y"], params: ["a"] };
    expect(evAt("a x + y", options, 2, { a: 3, y: 1 })).toBeCloseTo(7, 12);
  });

  it("5.1b does not split a run of undeclared letters: xy with only x declared is an unknown name at its offset", () => {
    const result = failWith("xy");
    expect(result.at).toBe(0);
    expect(result.error).toContain("xy");
  });

  it("5.1b reports an unknown name with its offset and the allowed names", () => {
    const result = failWith("x + foo", { vars: ["x", "y"] });
    expect(result.at).toBe(4);
    expect(result.error).toContain("foo");
    expect(result.error).toContain("x");
    expect(result.error).toContain("y");
  });

  it("5.1b reports a run that is not entirely declared letters, xz with x and y", () => {
    const source = "1 + xz";
    const result = failWith(source, { vars: ["x", "y"] });
    expect(result.at).toBe(4);
    expect(result.error).toContain("xz");
  });

  it("5.1b still reads a function name as a function, not as split letters", () => {
    expect(evAt("sin x", { vars: ["x", "y"] }, 1, { y: 0 })).toBeCloseTo(Math.sin(1), 12);
    expect(evAt("exp(x)", { vars: ["x", "y"] }, 1, { y: 0 })).toBeCloseTo(Math.E, 12);
  });

  it("5.1b still reads pi as a constant when variables are declared", () => {
    expect(evAt("pi x", { vars: ["x", "y"] }, 2, { y: 0 })).toBeCloseTo(2 * Math.PI, 12);
  });
});

describe("5.1c more functions and theta", () => {
  it.each([
    ["min(x, 3)", 5, 3],
    ["min(x, 3)", 1, 1],
    ["max(x, 3)", 5, 5],
    ["max(x, 3)", 1, 3],
    ["max(min(x, 4), -4)", 9, 4],
    ["atan2(1, x)", 2, Math.atan2(1, 2)],
    ["atan2(x, -1)", 1, Math.atan2(1, -1)],
    ["mod(x, 3)", 7, 1],
    ["mod(x, 3)", 9, 0],
    ["sign(x)", -4, -1],
    ["sign(x)", 0, 0],
    ["sign(x)", 6, 1],
    ["round(x)", 2.4, 2],
    ["round(x)", 2.6, 3],
    ["sec(x)", 0.7, 1 / Math.cos(0.7)],
    ["csc(x)", 0.7, 1 / Math.sin(0.7)],
    ["cot(x)", 0.7, 1 / Math.tan(0.7)],
  ])("5.1c evaluates %s at %d", (source, x, expected) => {
    expect(ev(source, x)).toBeCloseTo(expected, 9);
  });

  it("5.1c takes expressions as the arguments of a multi-argument function", () => {
    expect(ev("min(x^2, x + 6)", 3)).toBeCloseTo(9, 12);
    expect(ev("max(2x, 1 + x)", 3)).toBeCloseTo(6, 12);
  });

  it("5.1c takes two declared variables as atan2 arguments", () => {
    expect(evAt("atan2(y, x)", { vars: ["x", "y"] }, 2, { y: 3 })).toBeCloseTo(Math.atan2(3, 2), 12);
  });

  it("5.1c reads sec, csc and cot without parentheses like the other functions", () => {
    expect(ev("sec x", 0.5)).toBeCloseTo(1 / Math.cos(0.5), 12);
  });

  it("5.1c keeps the new functions non-throwing outside their domain", () => {
    expect(Number.isFinite(ev("cot(x)", 0))).toBe(false);
    expect(Number.isFinite(ev("csc(x)", 0))).toBe(false);
  });

  it("5.1c reads θ as the declared variable", () => {
    expect(evAt("sin(θ)", { vars: ["θ"] }, 0.9)).toBeCloseTo(Math.sin(0.9), 12);
    expect(evAt("2θ", { vars: ["θ"] }, 3)).toBeCloseTo(6, 12);
  });

  it("5.1c reads theta as the declared variable", () => {
    expect(evAt("sin(theta)", { vars: ["theta"] }, 0.9)).toBeCloseTo(Math.sin(0.9), 12);
    expect(evAt("2theta", { vars: ["theta"] }, 3)).toBeCloseTo(6, 12);
  });

  it("5.1c treats θ and theta as one variable whichever spelling is declared", () => {
    expect(evAt("1 + cos(theta)", { vars: ["θ"] }, 0.4)).toBeCloseTo(1 + Math.cos(0.4), 12);
    expect(evAt("1 + cos(θ)", { vars: ["theta"] }, 0.4)).toBeCloseTo(1 + Math.cos(0.4), 12);
  });

  it("5.1c gives the same value for the two spellings of a polar expression", () => {
    for (const angle of [0, 0.5, 2, 5]) {
      expect(evAt("1 + cos(θ)", { vars: ["θ"] }, angle)).toBeCloseTo(evAt("1 + cos(theta)", { vars: ["theta"] }, angle), 12);
    }
  });

  it("5.1c reads θ next to another variable, taken from env under either spelling", () => {
    const env = { θ: 2, theta: 2 };
    expect(evAt("x + θ", { vars: ["x", "θ"] }, 1, env)).toBeCloseTo(3, 12);
    expect(evAt("x + theta", { vars: ["x", "θ"] }, 1, env)).toBeCloseTo(3, 12);
  });

  it("5.1c rejects theta when it is not declared", () => {
    const result = failWith("theta + 1");
    expect(result.at).toBe(0);
  });
});
