/** Fingerprints a LaTeX preamble: main's text before `\begin{document}`, the local files it loads, the engine and the toolchain. */
import { createHash } from "node:crypto";
import * as path from "node:path";

import { readOptionalFile } from "../../../../../library/node/index.js";
import { resolveIncludePath, scanLatexSource } from "../../../source/index.js";
import type { LatexToolchain } from "../../../toolchain/index.js";

const BEGIN_DOCUMENT = "\\begin{document}";
const USEPACKAGE = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/** The project-relative paths, from main's folder, of the local files the preamble may load. */
function localCandidates(preamble: string): string[] {
  const inputs = scanLatexSource(preamble).includes.filter((fact) => fact.command === "input").map((fact) => resolveIncludePath(fact.path));
  const packages = [...preamble.matchAll(USEPACKAGE)].flatMap((match) => match[1]!.split(",")).map((name) => resolveIncludePath(`${name.trim()}.sty`));
  return [...inputs, ...packages].filter((file): file is string => file !== undefined);
}

/** The hash of main's preamble, or none when main has no `\begin{document}`. */
export async function preambleHash(toolchain: LatexToolchain, mainPath: string): Promise<string | undefined> {
  const text = (await readOptionalFile(mainPath)) ?? "";
  const end = text.indexOf(BEGIN_DOCUMENT);
  if (end < 0) { return undefined; }
  const preamble = text.slice(0, end);
  const hash = createHash("sha256").update(`${toolchain.engine}\0${toolchain.executable}\0${preamble}`);
  // A package that is not a local file is part of TeX Live, which the toolchain path already identifies.
  for (const file of localCandidates(preamble)) {
    const content = await readOptionalFile(path.join(path.dirname(mainPath), file));
    if (content !== undefined) { hash.update(`\0${file}\0${content}`); }
  }
  return hash.digest("hex");
}
