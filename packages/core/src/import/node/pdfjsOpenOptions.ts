/** Builds the getDocument options every Node caller shares: quiet, eval-free, and data files read from disk. */
import { join, sep } from "node:path";

import { resolvePdfjsPackageDir } from "./pdfjsPackage.js";

/**
 * Without the CMap and standard-font tables, text drawn with CID or non-embedded fonts extracts as blanks, which
 * starves the metadata heuristics. `useWorkerFetch: false` keeps the in-process worker from fetch()ing the paths.
 * @returns options to spread into getDocument
 */
export function pdfjsDataOptions(): Record<string, unknown> {
  const base = { verbosity: 0, isEvalSupported: false };
  const root = resolvePdfjsPackageDir();
  if (!root) {
    return base;
  }
  return {
    ...base,
    cMapUrl: join(root, "cmaps") + sep,
    cMapPacked: true,
    standardFontDataUrl: join(root, "standard_fonts") + sep,
    wasmUrl: join(root, "wasm") + sep,
    useWorkerFetch: false,
  };
}
