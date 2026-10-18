/** Builds the command line that compiles a LaTeX main file with every output file in one build folder. */

import type { LatexToolchain } from "../toolchain/index.js";
import { NO_SHELL_ESCAPE, TEX_FILE_ACCESS_ENV } from "./texSandbox.js";

export interface BuildCommand {
  executable: string;
  args: string[];
  /** Variables the run adds to the toolchain's environment. */
  env?: Record<string, string>;
}

const LATEXMK_ENGINE = { xelatex: "-xelatex", pdflatex: "-pdf", lualatex: "-lualatex" } as const;

export interface PartialBuild {
  /** An `\include` path relative to the project folder, without extension; only that chapter is typeset. */
  includeOnly?: string;
  /** Rebuilds even when no source changed. */
  force?: boolean;
}

/**
 * `mainFile` is the main file's name; the build runs in its folder, so \input paths resolve as the user wrote them.
 * `\includeonly` goes in through latexmk's pretex, so the other chapters keep the numbering of their `.aux` files.
 */
export function latexBuildCommand(toolchain: LatexToolchain, mainFile: string, outDir: string, partial: PartialBuild = {}): BuildCommand {
  // TRAP: latexmk does not track the pretex, so a changed `\includeonly` rebuilds only when forced.
  const { includeOnly } = partial;
  const partialArgs = [
    ...(partial.force || includeOnly !== undefined ? ["-g"] : []),
    ...(includeOnly !== undefined ? [`-usepretex=\\includeonly{${includeOnly}}`] : []),
  ];
  const engine = toolchain.engine;
  return {
    executable: toolchain.executable,
    args: [
      // PLATFORM: latexmk runs a project `latexmkrc` as Perl; `-norc` skips every rc file, and all settings are on this command line.
      "-norc", LATEXMK_ENGINE[engine], "-interaction=nonstopmode", "-file-line-error", "-synctex=1",
      `-auxdir=${outDir}`, `-outdir=${outDir}`,
      // PLATFORM: latexmk has no flag for the engine's options; its command string is set from Perl.
      "-e", `$${engine} = '${engine} ${NO_SHELL_ESCAPE} %O %S';`,
      ...partialArgs, mainFile,
    ],
    env: TEX_FILE_ACCESS_ENV,
  };
}
