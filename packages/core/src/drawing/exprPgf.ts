// Prints a parsed expression in pgfplots (pgfmath) syntax (decision D8). Parameters found in env are inlined as
// numbers, θ/theta becomes x (the polar caller maps it), function names map to their pgfmath names, and
// parentheses are written wherever pgfmath could read prefix minus or ^ differently from the parser.
import type { ExprNode } from "./expr.js";

const PGF_NAMES: Readonly<Record<string, string>> = { log: "log10", csc: "cosec" };
const THETA_SPELLINGS = new Set(["θ", "theta"]);

// Precedence of the printed text: 1 sum, 2 product, 3 negation, 4 power, 5 primary.
type Printed = { text: string; prec: number };

function formatNumber(value: number): string {
  if (Number.isNaN(value)) { return "nan"; }
  if (!Number.isFinite(value)) { return value > 0 ? "inf" : "-inf"; }
  const plain = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(plain);
  if (match === null) { return plain; }
  const [, sign, whole, fraction = "", exponentText] = match;
  const digits = whole! + fraction;
  const point = whole!.length + Number(exponentText);
  const shifted = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + shifted;
}

function number(value: number): Printed {
  const text = formatNumber(value);
  return text.startsWith("-") ? { text: `(${text})`, prec: 5 } : { text, prec: 5 };
}

function wrap(printed: Printed, minPrec: number): string {
  return printed.prec >= minPrec ? printed.text : `(${printed.text})`;
}

function print(node: ExprNode, env: Readonly<Record<string, number>> | undefined): Printed {
  switch (node.type) {
    case "num": return number(node.value);
    case "var": {
      const value = env?.[node.name];
      if (typeof value === "number") { return number(value); }
      return { text: THETA_SPELLINGS.has(node.name) ? "x" : node.name, prec: 5 };
    }
    case "call": {
      const args = node.args.map((arg) => print(arg, env).text).join(", ");
      return { text: `${PGF_NAMES[node.name] ?? node.name}(${args})`, prec: 5 };
    }
    case "neg": return { text: `-${wrap(print(node.arg, env), 5)}`, prec: 3 };
    case "bin": {
      const left = print(node.left, env);
      const right = print(node.right, env);
      // A negation is always parenthesised as an operand; ^ takes only primaries on both sides.
      if (node.op === "^") { return { text: `${wrap(left, 5)}^${wrap(right, 5)}`, prec: 4 }; }
      if (node.op === "*" || node.op === "/") {
        return { text: `${wrap(left, left.prec === 3 ? 5 : 2)}${node.op}${wrap(right, right.prec === 3 ? 5 : 4)}`, prec: 2 };
      }
      return { text: `${wrap(left, left.prec === 3 ? 5 : 1)} ${node.op} ${wrap(right, right.prec === 3 ? 5 : 2)}`, prec: 1 };
    }
  }
}

export function formatPgfExpr(ast: ExprNode, env?: Readonly<Record<string, number>>): string {
  return print(ast, env).text;
}
