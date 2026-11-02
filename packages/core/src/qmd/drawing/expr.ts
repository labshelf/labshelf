// Function-expression language of the drawing editor and the chart function plots (decisions D8, D9): plain math
// and a LaTeX subset parse by recursive descent into an AST that is evaluated by a tree walk; nothing reaches eval.
// Each parse declares its variables (default x; the first is the positional argument of evaluate) and parameters,
// both read from the env at evaluation.

export type ExprNode =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: ExprNode }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: ExprNode; right: ExprNode }
  | { type: "call"; name: string; args: ExprNode[] };

export type ExprResult =
  | { ok: true; ast: ExprNode; evaluate(x: number, env?: Readonly<Record<string, number>>): number }
  | { ok: false; error: string; at: number };

type Token =
  | { kind: "num"; text: string; at: number; value: number }
  | { kind: "name"; text: string; at: number }
  | { kind: "frac"; text: string; at: number }
  | { kind: "op"; text: string; at: number }
  | { kind: "bad"; text: string; at: number }
  | { kind: "end"; text: string; at: number };

type Fn = { name: string; arity: number; variadic?: boolean; apply: (...args: number[]) => number };

const one = (name: string, apply: (n: number) => number): Fn => ({ name, arity: 1, apply });
const FUNCTION_LIST: Array<[string, Fn]> = [
  ["sin", one("sin", Math.sin)], ["cos", one("cos", Math.cos)], ["tan", one("tan", Math.tan)],
  ["sec", one("sec", (n) => 1 / Math.cos(n))], ["csc", one("csc", (n) => 1 / Math.sin(n))], ["cot", one("cot", (n) => 1 / Math.tan(n))],
  ["asin", one("asin", Math.asin)], ["acos", one("acos", Math.acos)], ["atan", one("atan", Math.atan)],
  ["arcsin", one("asin", Math.asin)], ["arccos", one("acos", Math.acos)], ["arctan", one("atan", Math.atan)],
  ["sinh", one("sinh", Math.sinh)], ["cosh", one("cosh", Math.cosh)], ["tanh", one("tanh", Math.tanh)],
  ["exp", one("exp", Math.exp)], ["ln", one("ln", Math.log)], ["log", one("log", Math.log10)],
  ["sqrt", one("sqrt", Math.sqrt)], ["abs", one("abs", Math.abs)], ["floor", one("floor", Math.floor)], ["ceil", one("ceil", Math.ceil)],
  ["sign", one("sign", Math.sign)], ["round", one("round", (n) => Math.sign(n) * Math.round(Math.abs(n)))],
  ["min", { name: "min", arity: 2, variadic: true, apply: Math.min }], ["max", { name: "max", arity: 2, variadic: true, apply: Math.max }],
  ["atan2", { name: "atan2", arity: 2, apply: Math.atan2 }], ["mod", { name: "mod", arity: 2, apply: (a, b) => a % b }],
];
const FUNCTIONS = new Map<string, Fn>(FUNCTION_LIST);
const FUNCTIONS_BY_NAME = new Map<string, Fn>(FUNCTION_LIST.map(([, fn]) => [fn.name, fn]));
const CONSTANTS = new Map<string, number>([["pi", Math.PI], ["e", Math.E]]);
const LATEX_COMMANDS = new Set(["frac", "left", "right", "cdot", "times", "pi", "theta", ...FUNCTIONS.keys()]);
const THETA_SPELLINGS = ["θ", "theta"];

class ParseFailure extends Error {
  constructor(message: string, readonly at: number) { super(message); }
}

// Declared names (variables and parameters) by spelling; θ and theta resolve to whichever spelling was declared.
type Declared = { names: Map<string, string>; list: readonly string[] };

function declare(vars: readonly string[], params: readonly string[]): Declared {
  const names = new Map<string, string>();
  for (const name of [...vars, ...params]) {
    names.set(name, name);
    if (THETA_SPELLINGS.includes(name)) { for (const spelling of THETA_SPELLINGS) { if (!names.has(spelling)) { names.set(spelling, name); } } }
  }
  return { names, list: [...vars, ...params] };
}

function isDigit(c: string | undefined): boolean { return c !== undefined && c >= "0" && c <= "9"; }
function isLetter(c: string | undefined): boolean { return c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "θ"); }

function readWhile(source: string, from: number, accept: (c: string) => boolean): number {
  let end = from;
  while (end < source.length && accept(source[end]!)) { end += 1; }
  return end;
}

function readCommand(source: string, i: number): { token: Token; next: number } {
  const nameEnd = readWhile(source, i + 1, (c) => isLetter(c));
  const name = source.slice(i + 1, nameEnd);
  const bad = (text: string, next: number): { token: Token; next: number } => ({ token: { kind: "bad", text, at: i }, next });
  if (!LATEX_COMMANDS.has(name)) { return bad(source.slice(i, Math.max(nameEnd, i + 1)), Math.max(nameEnd, i + 1)); }
  if (name === "left" || name === "right") {
    const delimAt = readWhile(source, nameEnd, (c) => c === " " || c === "\t");
    const want = name === "left" ? "(" : ")";
    return source[delimAt] === want ? { token: { kind: "op", text: want, at: delimAt }, next: delimAt + 1 } : bad(`\\${name}`, nameEnd);
  }
  if (name === "cdot" || name === "times") { return { token: { kind: "op", text: "*", at: i }, next: nameEnd }; }
  if (name === "frac") { return { token: { kind: "frac", text: "\\frac", at: i }, next: nameEnd }; }
  return { token: { kind: "name", text: name, at: i }, next: nameEnd };
}

// A letter run that is no function, constant or declared name splits into one-letter declared names (xy -> x y).
function pushLetterRun(tokens: Token[], text: string, at: number, declared: Declared): void {
  const whole = FUNCTIONS.has(text) || CONSTANTS.has(text) || declared.names.has(text);
  if (!whole && text.length > 1 && [...text].every((c) => declared.names.has(c))) {
    [...text].forEach((c, k) => tokens.push({ kind: "name", text: c, at: at + k }));
    return;
  }
  tokens.push({ kind: "name", text, at });
}

function tokenize(source: string, declared: Declared): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i += 1; continue; }
    if (isDigit(c) || (c === "." && isDigit(source[i + 1]))) {
      let end = readWhile(source, i, (d) => isDigit(d));
      if (source[end] === ".") { end = readWhile(source, end + 1, (d) => isDigit(d)); }
      const text = source.slice(i, end);
      tokens.push({ kind: "num", text, at: i, value: Number(text) });
      i = end;
    } else if (isLetter(c)) {
      let end = readWhile(source, i, (d) => isLetter(d));
      const withDigits = readWhile(source, end, (d) => isDigit(d));
      if (withDigits > end && FUNCTIONS.has(source.slice(i, withDigits))) { end = withDigits; } // atan2
      pushLetterRun(tokens, source.slice(i, end), i, declared);
      i = end;
    } else if (c === "\\") {
      const { token, next } = readCommand(source, i);
      tokens.push(token);
      i = next;
    } else if ("+-*/^(){},".includes(c)) {
      tokens.push({ kind: "op", text: c, at: i });
      i += 1;
    } else {
      tokens.push({ kind: "bad", text: c, at: i });
      i += 1;
    }
  }
  tokens.push({ kind: "end", text: "", at: source.length });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly declared: Declared) {}

  private peek(): Token { return this.tokens[this.pos]!; }
  private next(): Token { const token = this.tokens[this.pos]!; if (token.kind !== "end") { this.pos += 1; } return token; }
  private isOp(text: string): boolean { const t = this.peek(); return t.kind === "op" && t.text === text; }

  private unexpected(token: Token): ParseFailure {
    if (token.kind === "end") { return new ParseFailure("unexpected end of expression", token.at); }
    if (token.kind === "name" && !FUNCTIONS.has(token.text) && !CONSTANTS.has(token.text) && !this.declared.names.has(token.text)) {
      const allowed = this.declared.list.length > 0 ? `the allowed names are ${this.declared.list.join(", ")}` : "no variables are declared";
      return new ParseFailure(`unknown name "${token.text}"; ${allowed}`, token.at);
    }
    return new ParseFailure(`unexpected "${token.text}"`, token.at);
  }

  parseAll(): ExprNode {
    const node = this.parseSum();
    const rest = this.peek();
    if (rest.kind !== "end") { throw this.unexpected(rest); }
    return node;
  }

  private parseSum(): ExprNode {
    let left = this.parseProduct();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().text as "+" | "-";
      left = { type: "bin", op, left, right: this.parseProduct() };
    }
    return left;
  }

  private startsFactor(token: Token): boolean {
    if (token.kind === "name" || token.kind === "frac") { return true; }
    return token.kind === "op" && (token.text === "(" || token.text === "{");
  }

  private parseProduct(): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = this.next().text as "*" | "/";
        left = { type: "bin", op, left, right: this.parseUnary() };
      } else if (this.startsFactor(this.peek())) {
        left = { type: "bin", op: "*", left, right: this.parsePower() };
      } else {
        return left;
      }
    }
  }

  private parseUnary(): ExprNode {
    if (this.isOp("-")) { this.next(); return { type: "neg", arg: this.parseUnary() }; }
    if (this.isOp("+")) { this.next(); return this.parseUnary(); }
    return this.parsePower();
  }

  private parsePower(): ExprNode {
    const base = this.parsePrimary();
    if (!this.isOp("^")) { return base; }
    this.next();
    return { type: "bin", op: "^", left: base, right: this.parseExponent() };
  }

  private parseExponent(): ExprNode {
    if (this.isOp("-")) { this.next(); return { type: "neg", arg: this.parseExponent() }; }
    if (this.isOp("+")) { this.next(); return this.parseExponent(); }
    return this.parsePower();
  }

  private expectOp(text: string): void {
    const token = this.next();
    if (token.kind !== "op" || token.text !== text) { throw this.unexpected(token); }
  }

  private parseGroup(open: "(" | "{"): ExprNode {
    this.expectOp(open);
    const inner = this.parseSum();
    this.expectOp(open === "(" ? ")" : "}");
    return inner;
  }

  private parseArgs(fn: Fn, at: number): ExprNode[] {
    this.expectOp("(");
    const args = [this.parseSum()];
    while (this.isOp(",")) { this.next(); args.push(this.parseSum()); }
    this.expectOp(")");
    if (fn.variadic ? args.length < fn.arity : args.length !== fn.arity) {
      throw new ParseFailure(`"${fn.name}" takes ${fn.variadic ? "at least " : ""}${fn.arity} arguments`, at);
    }
    return args;
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();
    if (token.kind === "num") { this.next(); return { type: "num", value: token.value }; }
    if (token.kind === "frac") {
      this.next();
      const numerator = this.parseGroup("{");
      const denominator = this.parseGroup("{");
      return { type: "bin", op: "/", left: numerator, right: denominator };
    }
    if (token.kind === "op" && (token.text === "(" || token.text === "{")) { return this.parseGroup(token.text); }
    if (token.kind === "name") {
      const fn = FUNCTIONS.get(token.text);
      if (fn !== undefined) {
        this.next();
        if (fn.arity > 1) { return { type: "call", name: fn.name, args: this.parseArgs(fn, token.at) }; }
        const open = this.peek();
        const arg = open.kind === "op" && (open.text === "(" || open.text === "{") ? this.parseGroup(open.text) : this.parsePower();
        return { type: "call", name: fn.name, args: [arg] };
      }
      const name = this.declared.names.get(token.text);
      if (name !== undefined) { this.next(); return { type: "var", name }; }
      const constant = CONSTANTS.get(token.text);
      if (constant !== undefined) { this.next(); return { type: "num", value: constant }; }
    }
    throw this.unexpected(token);
  }
}

function evaluateNode(node: ExprNode, lookup: (name: string) => number): number {
  switch (node.type) {
    case "num": return node.value;
    case "var": return lookup(node.name);
    case "neg": return -evaluateNode(node.arg, lookup);
    case "call": {
      const fn = FUNCTIONS_BY_NAME.get(node.name);
      return fn === undefined ? Number.NaN : fn.apply(...node.args.map((arg) => evaluateNode(arg, lookup)));
    }
    case "bin": {
      const a = evaluateNode(node.left, lookup);
      const b = evaluateNode(node.right, lookup);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "^": return Math.pow(a, b);
      }
    }
  }
}

function envValue(env: Readonly<Record<string, number>> | undefined, name: string): number {
  if (env === undefined) { return Number.NaN; }
  const spellings = THETA_SPELLINGS.includes(name) ? [name, ...THETA_SPELLINGS] : [name];
  for (const spelling of spellings) {
    const value = env[spelling];
    if (typeof value === "number") { return value; }
  }
  return Number.NaN;
}

export function parseExpr(text: string, options?: { vars?: readonly string[]; params?: readonly string[] }): ExprResult {
  const vars = options?.vars ?? ["x"];
  const declared = declare(vars, options?.params ?? []);
  const positional = vars[0];
  try {
    const ast = new Parser(tokenize(text, declared), declared).parseAll();
    const evaluate = (x: number, env?: Readonly<Record<string, number>>): number =>
      evaluateNode(ast, (name) => (name === positional ? x : envValue(env, name)));
    return { ok: true, ast, evaluate };
  } catch (error) {
    if (error instanceof ParseFailure) { return { ok: false, error: error.message, at: error.at }; }
    throw error;
  }
}
