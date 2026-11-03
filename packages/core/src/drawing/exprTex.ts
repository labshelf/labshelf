// Writes a parsed function expression (expr.ts) as TeX for display: fractions, powers, roots, absolute values, named
// functions with \sin-style commands, Greek variables and implicit products written without a dot between a number and a name.
import type { ExprNode } from "./expr.js";

const NAMED = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "exp", "ln", "log", "min", "max"]);
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "sigma", "tau", "phi", "omega", "pi"]);
const PRECEDENCE: Readonly<Record<string, number>> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };

function name(text: string): string {
  if (text === "θ") return "\\theta";
  return GREEK.has(text) ? `\\${text}` : text.length > 1 ? `\\mathrm{${text}}` : text;
}

const precedence = (node: ExprNode): number => (node.type === "bin" ? PRECEDENCE[node.op]! : node.type === "neg" ? 1.5 : 4);

/** The node, in parentheses when it binds looser than `min`. */
function wrapped(node: ExprNode, min: number): string {
  const tex = exprTex(node);
  return precedence(node) < min ? `\\left(${tex}\\right)` : tex;
}

/** A product: implicit (`2x`, `a\sin x`) when the right factor starts with a letter or a command, else with \cdot. */
function product(left: ExprNode, right: ExprNode): string {
  const a = wrapped(left, 2);
  const b = wrapped(right, 2.5);
  return right.type === "num" || /^\d/.test(b) ? `${a} \\cdot ${b}` : `${a}${/[a-zA-Z}]$/.test(a) && /^[a-zA-Z]/.test(b) ? " " : ""}${b}`;
}

function call(node: Extract<ExprNode, { type: "call" }>): string {
  const [arg] = node.args;
  if (node.name === "sqrt" && arg) return `\\sqrt{${exprTex(arg)}}`;
  if (node.name === "abs" && arg) return `\\left|${exprTex(arg)}\\right|`;
  if (node.name === "floor" && arg) return `\\lfloor ${exprTex(arg)} \\rfloor`;
  if (node.name === "ceil" && arg) return `\\lceil ${exprTex(arg)} \\rceil`;
  const head = NAMED.has(node.name) ? `\\${node.name}` : `\\operatorname{${node.name}}`;
  const args = node.args.map(exprTex).join(", ");
  // One simple argument reads without parentheses, as in \sin x.
  return node.args.length === 1 && arg && (arg.type === "var" || arg.type === "num") ? `${head} ${args}` : `${head}\\left(${args}\\right)`;
}

/** The TeX of the expression. */
export function exprTex(node: ExprNode): string {
  switch (node.type) {
    case "num": return String(node.value);
    case "var": return name(node.name);
    case "neg": return `-${wrapped(node.arg, 2)}`;
    case "call": return call(node);
    case "bin":
      if (node.op === "/") return `\\frac{${exprTex(node.left)}}{${exprTex(node.right)}}`;
      if (node.op === "^") return `${wrapped(node.left, 4)}^{${exprTex(node.right)}}`;
      if (node.op === "*") return product(node.left, node.right);
      return `${wrapped(node.left, 1)} ${node.op} ${wrapped(node.right, node.op === "-" ? 2 : 1)}`;
  }
}
