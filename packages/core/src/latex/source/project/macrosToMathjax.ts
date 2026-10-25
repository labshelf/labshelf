/** Converts scanned macro definitions to the `macros` record of MathJax's TeX input. */
import type { MacroFact } from "../facts.js";

export type MathJaxMacros = Record<string, string | [string, number] | [string, number, string]>;

/** Later definitions replace earlier ones; `\providecommand` never replaces an existing definition. */
export function deriveMathJaxMacros(macros: readonly MacroFact[]): MathJaxMacros {
  const result: MathJaxMacros = {};
  for (const macro of macros) {
    if (macro.command === "providecommand" && macro.name in result) { continue; }
    if (macro.defaultArg !== undefined) { result[macro.name] = [macro.body, macro.argCount, macro.defaultArg]; }
    else if (macro.argCount > 0) { result[macro.name] = [macro.body, macro.argCount]; }
    else { result[macro.name] = macro.body; }
  }
  return result;
}
