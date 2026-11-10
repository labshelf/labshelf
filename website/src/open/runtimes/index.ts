/**
 * The runtimes /open/ runs in the browser: Python cells through Pyodide, R cells through WebR, Typst through core's WASM compiler,
 * and LaTeX (experimental). Every heavy runtime loads only when first used: Pyodide and WebR from their CDNs, the Typst compiler as a chunk.
 */
import { createCellPort, type BrowserCellPort } from "./cells.js";
import type { BrowserCompileInput, BrowserCompileResult } from "./compileTypes.js";
import { createPythonSession } from "./python.js";
import { createRSession } from "./r.js";

export type { BrowserCompileInput, BrowserCompileResult } from "./compileTypes.js";

export const BROWSER_CELL_NOTICE = "Runs in your browser: a reduced version, slower, with fewer libraries and no access to your computer's packages or files.";

export const LATEX_EXPERIMENTAL_NOTICE = "LaTeX in the browser is experimental: it may be slow, may lack packages your project uses, and its PDF can differ from a build on your computer.";

/** Python through Pyodide, R through WebR; any other language answers {status: "error", error: "<Language> cells run only on your computer."}. */
export function createBrowserCellPort(): BrowserCellPort {
  return createCellPort((language) => language === "python" ? createPythonSession() : createRSession());
}

export async function compileInBrowser(input: BrowserCompileInput, signal?: AbortSignal): Promise<BrowserCompileResult> {
  if (input.format === "typst") { return (await import("./typst.js")).compileTypst(input, signal); }
  return (await import("./latex.js")).compileLatex(input, signal);
}
