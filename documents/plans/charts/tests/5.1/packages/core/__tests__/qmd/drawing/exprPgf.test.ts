// Tests the pgfplots printer for parsed expressions (decision D8): functions map to their pgfmath names, parameters are inlined, and parentheses keep the parsed precedence so pgfplots reads the same value.
import { parseExpr, type ExprNode } from "../../../src/qmd/drawing/expr";
import { formatPgfExpr } from "../../../src/qmd/drawing/exprPgf";

type Options = { vars?: readonly string[]; params?: readonly string[] };
type Env = Readonly<Record<string, number>>;

function pgf(source: string, options?: Options, params?: Env): string {
  const result = parseExpr(source, options);
  if (!result.ok) { throw new Error(`"${source}" did not parse: ${result.error} at ${result.at}`); }
  return formatPgfExpr(result.ast, params);
}

const num = (value: number): ExprNode => ({ type: "num", value });
const variable = (name: string): ExprNode => ({ type: "var", name });
const bin = (op: "+" | "-" | "*" | "/" | "^", left: ExprNode, right: ExprNode): ExprNode => ({ type: "bin", op, left, right });

// A small reader for the printed text. pgfmath is not run here, so the reader is deliberately conservative: it reads the text under both readings of prefix minus (looser or tighter than ^) and both associativities of ^, and a printed string only counts when every reading gives the same value. Exponents must be a plain operand or a parenthesised group.
type Mode = { rightPow: boolean };
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log10: Math.log10,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  sec: (a) => 1 / Math.cos(a), cosec: (a) => 1 / Math.sin(a), cot: (a) => 1 / Math.tan(a),
  min: Math.min, max: Math.max, atan2: Math.atan2, mod: (a, b) => a - b * Math.floor(a / b),
  sign: Math.sign, round: Math.round,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function readPgf(text: string, env: Env, mode: Mode): number {
  const tokens = text.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z_0-9]*|[-+*/^(),]|\S/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (expected?: string): string => {
    const token = tokens[i++];
    if (token === undefined || (expected !== undefined && token !== expected)) { throw new Error(`expected ${expected ?? "a token"} but found ${token} in "${text}"`); }
    return token;
  };
  const expr = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") { value = take() === "+" ? value + term() : value - term(); }
    return value;
  };
  const term = (): number => {
    let value = unary();
    while (peek() === "*" || peek() === "/") { value = take() === "*" ? value * unary() : value / unary(); }
    return value;
  };
  const unary = (): number => {
    if (peek() === "-") { take(); return -unary(); }
    if (peek() === "+") { take(); return unary(); }
    return power();
  };
  const power = (): number => {
    const bases = [primary()];
    while (peek() === "^") { take(); bases.push(primary()); }
    if (mode.rightPow) { return bases.reduceRight((acc, base) => base ** acc); }
    return bases.reduce((acc, exponent) => acc ** exponent);
  };
  const primary = (): number => {
    const token = take();
    if (/^(?:\d|\.\d)/.test(token)) { return Number(token); }
    if (token === "(") { const value = expr(); take(")"); return value; }
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === "(") {
        take("(");
        const args = [expr()];
        while (peek() === ",") { take(","); args.push(expr()); }
        take(")");
        const fn = FUNCS[token];
        if (fn === undefined) { throw new Error(`unknown function ${token} in "${text}"`); }
        return fn(...args);
      }
      const fromEnv = env[token];
      if (fromEnv !== undefined) { return fromEnv; }
      const constant = CONSTS[token];
      if (constant !== undefined) { return constant; }
      throw new Error(`unknown name ${token} in "${text}"`);
    }
    throw new Error(`unexpected ${token} in "${text}"`);
  };
  const value = expr();
  if (i !== tokens.length) { throw new Error(`trailing ${tokens[i]} in "${text}"`); }
  return value;
}

// The tight-minus reading needs its own grammar for "-x^2": the prefix minus is taken inside the base.
function readTight(text: string, env: Env, rightPow: boolean): number {
  const tokens = text.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z_0-9]*|[-+*/^(),]|\S/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (expected?: string): string => {
    const token = tokens[i++];
    if (token === undefined || (expected !== undefined && token !== expected)) { throw new Error(`expected ${expected ?? "a token"} but found ${token} in "${text}"`); }
    return token;
  };
  const expr = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") { value = take() === "+" ? value + term() : value - term(); }
    return value;
  };
  const term = (): number => {
    let value = power();
    while (peek() === "*" || peek() === "/") { value = take() === "*" ? value * power() : value / power(); }
    return value;
  };
  const signed = (): number => {
    if (peek() === "-") { take(); return -signed(); }
    if (peek() === "+") { take(); return signed(); }
    return primary();
  };
  const power = (): number => {
    const bases = [signed()];
    while (peek() === "^") { take(); bases.push(primary()); }
    return rightPow ? bases.reduceRight((acc, base) => base ** acc) : bases.reduce((acc, exponent) => acc ** exponent);
  };
  const primary = (): number => {
    const token = take();
    if (/^(?:\d|\.\d)/.test(token)) { return Number(token); }
    if (token === "(") { const value = expr(); take(")"); return value; }
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === "(") {
        take("(");
        const args = [expr()];
        while (peek() === ",") { take(","); args.push(expr()); }
        take(")");
        const fn = FUNCS[token];
        if (fn === undefined) { throw new Error(`unknown function ${token} in "${text}"`); }
        return fn(...args);
      }
      const fromEnv = env[token];
      if (fromEnv !== undefined) { return fromEnv; }
      const constant = CONSTS[token];
      if (constant !== undefined) { return constant; }
      throw new Error(`unknown name ${token} in "${text}"`);
    }
    throw new Error(`unexpected ${token} in "${text}"`);
  };
  const value = expr();
  if (i !== tokens.length) { throw new Error(`trailing ${tokens[i]} in "${text}"`); }
  return value;
}

function readsAs(text: string, env: Env, expected: number): void {
  const readings = [
    readPgf(text, env, { rightPow: true }),
    readPgf(text, env, { rightPow: false }),
    readTight(text, env, true),
    readTight(text, env, false),
  ];
  for (const reading of readings) {
    if (Number.isNaN(expected)) { expect(reading).toBeNaN(); } else { expect(reading).toBeCloseTo(expected, 9); }
  }
}

describe("5.1d names and functions in pgfplots syntax", () => {
  it("5.1d prints log as log10 and not as a bare log", () => {
    const text = pgf("log(x)");
    expect(text).toContain("log10(");
    expect(text).not.toMatch(/(^|[^0-9A-Za-z_])log\(/);
    readsAs(text, { x: 1000 }, 3);
  });

  it("5.1d prints ln as ln", () => {
    const text = pgf("ln(x)");
    expect(text).toMatch(/\bln\(/);
    expect(text).not.toContain("log10");
    readsAs(text, { x: Math.E }, 1);
  });

  it("5.1d keeps the trig function names unchanged", () => {
    expect(pgf("sin(x)")).toMatch(/\bsin\(/);
    expect(pgf("cos(x)")).toMatch(/\bcos\(/);
    expect(pgf("tan(x)")).toMatch(/\btan\(/);
    readsAs(pgf("sin(x) + cos(x) + tan(x)"), { x: 0.6 }, Math.sin(0.6) + Math.cos(0.6) + Math.tan(0.6));
  });

  it("5.1d prints sec, csc and cot as sec, cosec and cot", () => {
    expect(pgf("sec(x)")).toMatch(/\bsec\(/);
    expect(pgf("csc(x)")).toMatch(/\bcosec\(/);
    expect(pgf("csc(x)")).not.toContain("csc");
    expect(pgf("cot(x)")).toMatch(/\bcot\(/);
    readsAs(pgf("sec(x)"), { x: 0.7 }, 1 / Math.cos(0.7));
    readsAs(pgf("csc(x)"), { x: 0.7 }, 1 / Math.sin(0.7));
    readsAs(pgf("cot(x)"), { x: 0.7 }, 1 / Math.tan(0.7));
  });

  it("5.1d prints mod, sign and round under their own names", () => {
    expect(pgf("mod(x, 3)")).toMatch(/\bmod\(/);
    expect(pgf("sign(x)")).toMatch(/\bsign\(/);
    expect(pgf("round(x)")).toMatch(/\bround\(/);
    readsAs(pgf("mod(x, 3)"), { x: 7 }, 1);
    readsAs(pgf("sign(x)"), { x: -2 }, -1);
    readsAs(pgf("round(x)"), { x: 2.6 }, 3);
  });

  it("5.1d prints multi-argument calls with every argument", () => {
    readsAs(pgf("min(x, 3)"), { x: 5 }, 3);
    readsAs(pgf("max(x, y)", { vars: ["x", "y"] }), { x: 5, y: 8 }, 8);
    readsAs(pgf("atan2(y, x)", { vars: ["x", "y"] }), { x: 2, y: 3 }, Math.atan2(3, 2));
  });

  it("5.1d keeps x and y under their own names", () => {
    const text = pgf("x^2 + y^2", { vars: ["x", "y"] });
    expect(text).toMatch(/\bx\b/);
    expect(text).toMatch(/\by\b/);
    readsAs(text, { x: 3, y: 4 }, 25);
  });

  it("5.1d keeps t as t", () => {
    const text = pgf("cos(t)", { vars: ["t"] });
    expect(text).toMatch(/\bt\b/);
    readsAs(text, { t: 0.8 }, Math.cos(0.8));
  });

  it("5.1d prints θ as x", () => {
    const text = pgf("1 + cos(θ)", { vars: ["θ"] });
    expect(text).not.toContain("θ");
    expect(text).toMatch(/\bx\b/);
    readsAs(text, { x: 0.8 }, 1 + Math.cos(0.8));
  });

  it("5.1d prints theta as x", () => {
    const text = pgf("2 sin(theta)", { vars: ["theta"] });
    expect(text).not.toContain("theta");
    expect(text).toMatch(/\bx\b/);
    readsAs(text, { x: 0.8 }, 2 * Math.sin(0.8));
  });

  it("5.1d prints pi and e so that pgfplots reads their values", () => {
    readsAs(pgf("pi x"), { x: 2 }, 2 * Math.PI);
    readsAs(pgf("e^x"), { x: 2 }, Math.exp(2));
  });
});

describe("5.1d parameters are inlined", () => {
  it("5.1d replaces a parameter by its number", () => {
    const text = pgf("a x^2", { params: ["a"] }, { a: 3 });
    expect(text).not.toMatch(/\ba\b/);
    expect(text).toContain("3");
    readsAs(text, { x: 2 }, 12);
  });

  it("5.1d inlines a decimal parameter", () => {
    const text = pgf("a*x", { params: ["a"] }, { a: 0.25 });
    expect(text).not.toMatch(/\ba\b/);
    readsAs(text, { x: 8 }, 2);
  });

  it("5.1d inlines a negative parameter without changing the value", () => {
    readsAs(pgf("a*x", { params: ["a"] }, { a: -2 }), { x: 5 }, -10);
    readsAs(pgf("x - a", { params: ["a"] }, { a: -2 }), { x: 5 }, 7);
    readsAs(pgf("a^2", { params: ["a"] }, { a: -2 }), {}, 4);
    readsAs(pgf("x^a", { params: ["a"] }, { a: -2 }), { x: 2 }, 0.25);
  });

  it("5.1d inlines two parameters beside variables", () => {
    const text = pgf("a x + b y", { vars: ["x", "y"], params: ["a", "b"] }, { a: 2, b: 5 });
    expect(text).not.toMatch(/\ba\b/);
    expect(text).not.toMatch(/\bb\b/);
    readsAs(text, { x: 3, y: 4 }, 26);
  });

  it("5.1d prints a number node as a number", () => {
    readsAs(formatPgfExpr(bin("*", num(0.5), variable("x"))), { x: 6 }, 3);
    readsAs(formatPgfExpr(bin("+", num(1234.5678), variable("x"))), { x: 1 }, 1235.5678);
  });
});

describe("5.1d precedence is kept with parentheses", () => {
  it.each([
    ["(x + 1) * (x - 1)", 3, 8],
    ["(x + 1) * 2", 3, 8],
    ["2 * (x + 1)", 3, 8],
    ["x - (y - 1)", 5, 5 - (2 - 1)],
    ["x - (y + 1)", 5, 5 - (2 + 1)],
    ["x - y - 1", 5, 2],
    ["x / (y * 2)", 8, 2],
    ["x / (y / 2)", 8, 8],
    ["x / y / 2", 8, 2],
    ["x / (y + 2)", 8, 2],
    ["(x + 1) / (y - 1)", 5, 6],
    ["(x + 1)^2", 3, 16],
    ["x^(y + 1)", 2, 8],
    ["x^2 + y^2", 3, 13],
    ["2^3^2", 0, 512],
    ["(2^3)^2", 0, 64],
    ["(x^y)^2", 2, 16],
    ["x^(y^2)", 2, 16],
    ["-x^2", 3, -9],
    ["(-x)^2", 3, 9],
    ["-(x + 1)", 3, -4],
    ["-(x - y)", 3, -1],
    ["x - -y", 3, 5],
    ["2 - (-x)", 3, 5],
    ["sin(x)^2", 1, Math.sin(1) ** 2],
    ["sin(x^2)", 1, Math.sin(1)],
    ["sin(x + y) * 2", 1, 2 * Math.sin(3)],
    ["2x^2 + 3x + 1", 2, 15],
    ["1 / (1 + x^2)", 2, 0.2],
    ["e^(-x^2)", 1, Math.exp(-1)],
  ])("5.1d prints %s so it reads the same value", (source, x, expected) => {
    const parsedResult = parseExpr(source, { vars: ["x", "y"] });
    if (!parsedResult.ok) { throw new Error(parsedResult.error); }
    const env = { x, y: 2 };
    expect(parsedResult.evaluate(env.x, env)).toBeCloseTo(expected, 9);
    readsAs(formatPgfExpr(parsedResult.ast), env, expected);
  });

  it("5.1d keeps the grouping of a hand-built subtraction", () => {
    const ast = bin("-", num(1), bin("-", num(2), num(3)));
    readsAs(formatPgfExpr(ast), {}, 2);
  });

  it("5.1d keeps the grouping of a hand-built division", () => {
    const ast = bin("/", num(12), bin("*", num(2), num(3)));
    readsAs(formatPgfExpr(ast), {}, 2);
    readsAs(formatPgfExpr(bin("/", num(12), bin("/", num(6), num(3)))), {}, 6);
  });

  it("5.1d keeps a hand-built sum under a product", () => {
    readsAs(formatPgfExpr(bin("*", bin("+", variable("x"), num(1)), bin("+", variable("x"), num(2)))), { x: 3 }, 20);
  });

  it("5.1d keeps a negative number node as a base of a power", () => {
    readsAs(formatPgfExpr(bin("^", num(-2), num(2))), {}, 4);
    readsAs(formatPgfExpr(bin("^", num(-2), num(3))), {}, -8);
  });

  it("5.1d keeps a negation under a power and a power under a negation", () => {
    readsAs(formatPgfExpr(bin("^", { type: "neg", arg: variable("x") }, num(2))), { x: 3 }, 9);
    readsAs(formatPgfExpr({ type: "neg", arg: bin("^", variable("x"), num(2)) }), { x: 3 }, -9);
  });

  it("5.1d keeps a power in an exponent", () => {
    readsAs(formatPgfExpr(bin("^", num(2), bin("^", num(3), num(2)))), {}, 512);
    readsAs(formatPgfExpr(bin("^", bin("^", num(2), num(3)), num(2))), {}, 64);
  });

  it("5.1d prints a call with expression arguments", () => {
    const ast: ExprNode = { type: "call", name: "max", args: [bin("+", variable("x"), num(1)), bin("*", num(2), variable("x"))] };
    readsAs(formatPgfExpr(ast), { x: 3 }, 6);
    readsAs(formatPgfExpr(ast), { x: 0 }, 1);
  });

  it("5.1d returns a string with no unresolved parameter for a full chart expression", () => {
    const text = pgf("a*sin(b*x) + c", { params: ["a", "b", "c"] }, { a: 2, b: 3, c: 1 });
    expect(typeof text).toBe("string");
    expect(text).not.toMatch(/\b[abc]\b/);
    readsAs(text, { x: 0.5 }, 2 * Math.sin(1.5) + 1);
  });
});
