/** Builds the command line that compiles a LaTeX main file with every output file in one build folder. */

import type { LatexToolchain } from "../toolchain/index.js";

export interface BuildCommand {
  executable: string;
  args: string[];
}

const LATEXMK_ENGINE = { xelatex: "-xelatex", pdflatex: "-pdf", lualatex: "-lualatex" } as const;

/** `mainFile` is the main file's name; the build runs in its folder, so \input paths resolve as the user wrote them. */
export function latexBuildCommand(toolchain: LatexToolchain, mainFile: string, outDir: string): BuildCommand {
  if (toolchain.engine === "tectonic") {
    return {
      executable: toolchain.executable,
      args: ["-X", "compile", mainFile, "--outdir", outDir, "--synctex", "--keep-logs", "--keep-intermediates"],
    };
  }
  return {
    executable: toolchain.executable,
    args: [
      LATEXMK_ENGINE[toolchain.engine], "-interaction=nonstopmode", "-file-line-error", "-synctex=1",
      `-auxdir=${outDir}`, `-outdir=${outDir}`, mainFile,
    ],
  };
}
