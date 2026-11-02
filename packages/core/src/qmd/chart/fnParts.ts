// The helpers the 2D and 3D function samplers share (sample2d.ts, sample3d.ts): the expression parts of a function parsed
// against its own variable names and the chart's variables, and the chart's variables as an evaluation environment. DOM-free.
import { parseExpr } from "../drawing/expr.js";
import type { ChartVar } from "./model.js";

export type Env = Record<string, number>;
export type Evaluate = (x: number, env: Readonly<Record<string, number>>) => number;
export type FnError = { message: string; at: number; part: number };

/** The expression parts of a function parsed against its own variable names and the chart's variables; the first failure is the error. */
export function parseParts(expr: readonly string[], count: number, own: readonly string[], chartVars: readonly ChartVar[]): { parts: Evaluate[]; error: null } | { parts: null; error: FnError } {
  const params = chartVars.map((v) => v.name).filter((name) => !own.includes(name));
  const parts: Evaluate[] = [];
  for (let part = 0; part < count; part += 1) {
    const text = expr[part];
    if (text === undefined) { return { parts: null, error: { message: "missing expression", at: 0, part } }; }
    const parsed = parseExpr(text, { vars: own, params });
    if (!parsed.ok) { return { parts: null, error: { message: parsed.error, at: parsed.at, part } }; }
    parts.push(parsed.evaluate);
  }
  return { parts, error: null };
}

/** The chart's variables as name to value. */
export function envOf(chartVars: readonly ChartVar[]): Env {
  const env: Env = {};
  for (const v of chartVars) { env[v.name] = v.value; }
  return env;
}
