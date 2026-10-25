// Describes the program that builds a LaTeX project and the label users see for each engine.
import type { LatexEngine } from "../../writing/project/index.js";

export interface LatexToolchain {
  engine: LatexEngine;
  /** The latexmk program. */
  executable: string;
  /** The folder of the TeX programs, put first on the build's PATH because latexmk finds the engine by name. */
  binDir?: string;
}

const ENGINE_LABELS: Readonly<Record<LatexEngine, string>> = {
  xelatex: "XeLaTeX",
  pdflatex: "pdfLaTeX",
  lualatex: "LuaLaTeX",
};

export function engineLabel(engine: LatexEngine): string {
  return ENGINE_LABELS[engine];
}
