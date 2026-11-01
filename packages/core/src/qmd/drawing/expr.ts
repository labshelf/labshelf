// Function-expression language of the drawing editor (decision D9): plain math and a LaTeX subset
// parse by recursive descent into an AST that is evaluated by a tree walk; nothing reaches eval.

export type ExprResult = { ok: true; evaluate(x: number): number } | { ok: false; error: string; at: number };

type Node =
  | { kind: "num"; value: number }
  | { kind: "var" }
  | { kind: "neg"; operand: Node }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { kind: "call"; fn: (n: number) => number; arg: Node };

type Token =
  | { kind: "num"; text: string; at: number; value: number }
  | { kind: "name"; text: string; at: number }
  | { kind: "frac"; text: string; at: number }
  | { kind: "op"; text: string; at: number }
  | { kind: "bad"; text: string; at: number }
  | { kind: "end"; text: string; at: number };

const FUNCTIONS = new Map<string, (n: number) => number>([
  ["sin", Math.sin], ["cos", Math.cos], ["tan", Math.tan],
  ["asin", Math.asin], ["acos", Math.acos], ["atan", Math.atan],
  ["arcsin", Math.asin], ["arccos", Math.acos], ["arctan", Math.atan],
  ["sinh", Math.sinh], ["cosh", Math.cosh], ["tanh", Math.tanh],
  ["exp", Math.exp], ["ln", Math.log], ["log", Math.log10],
  ["sqrt", Math.sqrt], ["abs", Math.abs], ["floor", Math.floor], ["ceil", Math.ceil],
]);
const CONSTANTS = new Map<string, number>([["pi", Math.PI], ["e", Math.E]]);
const LATEX_COMMANDS = new Set(["frac", "left", "right", "cdot", "times", "pi", ...FUNCTIONS.keys()]);

class ParseFailure extends Error {
  constructor(message: string, readonly at: number) { super(message); }
}

function isDigit(c: string | undefined): boolean { return c !== undefined && c >= "0" && c <= "9"; }
function isLetter(c: string | undefined): boolean { return c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")); }

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

function tokenize(source: string): Token[] {
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
      const end = readWhile(source, i, (d) => isLetter(d));
      tokens.push({ kind: "name", text: source.slice(i, end), at: i });
      i = end;
    } else if (c === "\\") {
      const { token, next } = readCommand(source, i);
      tokens.push(token);
      i = next;
    } else if ("+-*/^(){}".includes(c)) {
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
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]!; }
  private next(): Token { const token = this.tokens[this.pos]!; if (token.kind !== "end") { this.pos += 1; } return token; }
  private isOp(text: string): boolean { const t = this.peek(); return t.kind === "op" && t.text === text; }

  private unexpected(token: Token): ParseFailure {
    if (token.kind === "end") { return new ParseFailure("unexpected end of expression", token.at); }
    if (token.kind === "name" && !FUNCTIONS.has(token.text) && !CONSTANTS.has(token.text) && token.text !== "x") {
      return new ParseFailure(`unknown name "${token.text}"; the only variable is x`, token.at);
    }
    return new ParseFailure(`unexpected "${token.text}"`, token.at);
  }

  parseAll(): Node {
    const node = this.parseSum();
    const rest = this.peek();
    if (rest.kind !== "end") { throw this.unexpected(rest); }
    return node;
  }

  private parseSum(): Node {
    let left = this.parseProduct();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().text as "+" | "-";
      left = { kind: "bin", op, left, right: this.parseProduct() };
    }
    return left;
  }

  private startsFactor(token: Token): boolean {
    if (token.kind === "name" || token.kind === "frac") { return true; }
    return token.kind === "op" && (token.text === "(" || token.text === "{");
  }

  private parseProduct(): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = this.next().text as "*" | "/";
        left = { kind: "bin", op, left, right: this.parseUnary() };
      } else if (this.startsFactor(this.peek())) {
        left = { kind: "bin", op: "*", left, right: this.parsePower() };
      } else {
        return left;
      }
    }
  }

  private parseUnary(): Node {
    if (this.isOp("-")) { this.next(); return { kind: "neg", operand: this.parseUnary() }; }
    if (this.isOp("+")) { this.next(); return this.parseUnary(); }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePrimary();
    if (!this.isOp("^")) { return base; }
    this.next();
    return { kind: "bin", op: "^", left: base, right: this.parseExponent() };
  }

  private parseExponent(): Node {
    if (this.isOp("-")) { this.next(); return { kind: "neg", operand: this.parseExponent() }; }
    if (this.isOp("+")) { this.next(); return this.parseExponent(); }
    return this.parsePower();
  }

  private parseGroup(open: "(" | "{"): Node {
    const opening = this.next();
    if (opening.kind !== "op" || opening.text !== open) { throw this.unexpected(opening); }
    const inner = this.parseSum();
    const close = this.next();
    if (close.kind !== "op" || close.text !== (open === "(" ? ")" : "}")) { throw this.unexpected(close); }
    return inner;
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (token.kind === "num") { this.next(); return { kind: "num", value: token.value }; }
    if (token.kind === "frac") {
      this.next();
      const numerator = this.parseGroup("{");
      const denominator = this.parseGroup("{");
      return { kind: "bin", op: "/", left: numerator, right: denominator };
    }
    if (token.kind === "op" && (token.text === "(" || token.text === "{")) { return this.parseGroup(token.text); }
    if (token.kind === "name") {
      if (token.text === "x") { this.next(); return { kind: "var" }; }
      const constant = CONSTANTS.get(token.text);
      if (constant !== undefined) { this.next(); return { kind: "num", value: constant }; }
      const fn = FUNCTIONS.get(token.text);
      if (fn !== undefined) {
        this.next();
        const open = this.peek();
        const arg = open.kind === "op" && (open.text === "(" || open.text === "{") ? this.parseGroup(open.text) : this.parsePower();
        return { kind: "call", fn, arg };
      }
    }
    throw this.unexpected(token);
  }
}

function evaluateNode(node: Node, x: number): number {
  switch (node.kind) {
    case "num": return node.value;
    case "var": return x;
    case "neg": return -evaluateNode(node.operand, x);
    case "call": return node.fn(evaluateNode(node.arg, x));
    case "bin": {
      const a = evaluateNode(node.left, x);
      const b = evaluateNode(node.right, x);
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

export function parseExpr(source: string): ExprResult {
  try {
    const tree = new Parser(tokenize(source)).parseAll();
    return { ok: true, evaluate: (x: number) => evaluateNode(tree, x) };
  } catch (error) {
    if (error instanceof ParseFailure) { return { ok: false, error: error.message, at: error.at }; }
    throw error;
  }
}
