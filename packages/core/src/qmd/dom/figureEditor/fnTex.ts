// How a plot function reads in the editor: its default name (f, g, h… in 2D, S, P, Q… in 3D), its TeX (f(x) = \sin x,
// S(x,y) = …, parametric and polar curves, relations) typeset by MathJax, and the first bad expression its sampler finds.
import { exprTex, parseExpr } from "../../../drawing/index.js";
import { EXPORT_THEME, fnTraces2d, fnTraces3d, type ChartFn, type ChartVar } from "../../chart/index.js";
import { parseSvg, type MathLoader } from "../drawingEditor/index.js";

const NAMES_2D = ["f", "g", "h", "p", "q", "r", "u", "w"];
const NAMES_3D = ["S", "P", "Q", "R", "T", "U", "V", "W"];
const DIMS_3D: ReadonlySet<ChartFn["kind"]> = new Set(["surface", "param3d", "curve3d"]);
const DEFAULT_VIEW: [number, number] = [-10, 10];
const REL: Readonly<Record<string, string>> = { "=": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge" };

/** The variables each kind's expressions are written in. */
export const FN_VARS: Readonly<Record<ChartFn["kind"], readonly string[]>> = {
  y: ["x"], x: ["y"], param: ["t"], polar: ["θ", "t"], implicit: ["x", "y"], surface: ["x", "y"], param3d: ["u", "v"], curve3d: ["t"],
};

export const isFn3d = (fn: ChartFn): boolean => DIMS_3D.has(fn.kind);

/** The name a function shows: its own, else the next free letter of its dimension. */
export function fnName(fn: ChartFn, index: number, fns: readonly ChartFn[]): string {
  if (fn.name?.trim()) return fn.name.trim();
  const same = fns.slice(0, index).filter((other) => isFn3d(other) === isFn3d(fn) && !other.name?.trim()).length;
  const names = isFn3d(fn) ? NAMES_3D : NAMES_2D;
  return names[same % names.length]!;
}

/** The TeX of one expression in the kind's variables, or the text itself (escaped) when it does not parse. */
function part(text: string, fn: ChartFn, vars: readonly ChartVar[]): string {
  const parsed = parseExpr(text, { vars: FN_VARS[fn.kind], params: vars.map((v) => v.name) });
  return parsed.ok ? exprTex(parsed.ast) : `\\text{${text.replace(/[\\{}$&#^_%~]/g, " ") || "…"}}`;
}

/** The TeX a function reads as. */
export function fnTex(fn: ChartFn, index: number, fns: readonly ChartFn[], vars: readonly ChartVar[]): string {
  const name = fnName(fn, index, fns);
  const parts = fn.expr.map((text) => part(text, fn, vars));
  const rel = REL[fn.rel ?? "="]!;
  switch (fn.kind) {
    case "y": return fn.rel && fn.rel !== "=" ? `y ${rel} ${parts[0]}` : `${name}(x) = ${parts[0]}`;
    case "x": return `x ${rel} ${parts[0]}`;
    case "param": return `${name}(t) = \\left(${parts.join(", ")}\\right)`;
    case "polar": return `r(\\theta) = ${parts[0]}`;
    case "implicit": return `${parts[0]} = ${parts[1] ?? "0"}`;
    case "surface": return `${name}(x, y) = ${parts[0]}`;
    case "param3d": return `${name}(u, v) = \\left(${parts.join(", ")}\\right)`;
    case "curve3d": return `${name}(t) = \\left(${parts.join(", ")}\\right)`;
  }
}

/** The typeset TeX as an SVG element, or the TeX as text when MathJax cannot set it. */
export async function typeset(tex: string, loadMath: MathLoader): Promise<Node> {
  try {
    const svg = parseSvg((await loadMath()).renderMathSvg(tex, false));
    if (svg !== null) return svg;
  } catch { /* shown as text below */ }
  return document.createTextNode(tex);
}

/** The first bad expression of a function, as its sampler reports it, or null. */
export function fnError(fn: ChartFn, vars: readonly ChartVar[]): string | null {
  const error = isFn3d(fn) ? fnTraces3d(fn, vars, "Viridis").error : fnTraces2d(fn, vars, { x: DEFAULT_VIEW, y: DEFAULT_VIEW }, EXPORT_THEME.palette[0]!).error;
  return error === null ? null : error.message;
}
