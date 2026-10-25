/** Builds the command line that compiles a LaTeX main file with every output file in one build folder. */

import { createBiberAssignment, type BiberCommand } from "../biber/index.js";
import type { LatexToolchain } from "../toolchain/index.js";
import { SECTION_STATE_PACKAGE } from "./section/index.js";
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

export interface LatexBuildOptions extends PartialBuild {
  /** Loads the section state package, which the caller has put into `outDir`, before the document. */
  capturesSectionState?: boolean;
  /** Runs biber through this command instead of the TeX's own biber. */
  biber?: BiberCommand;
  /** Stops the engine at the first error instead of continuing. */
  haltOnError?: boolean;
}

/**
 * `mainFile` is the main file's name; the build runs in its folder, so \input paths resolve as the user wrote them.
 * `\includeonly` goes in through latexmk's pretex, so the other chapters keep the numbering of their `.aux` files.
 */
export function createLatexBuildCommand(toolchain: LatexToolchain, mainFile: string, outDir: string, options: LatexBuildOptions = {}): BuildCommand {
  // TRAP: latexmk does not track the pretex, so a changed `\includeonly` rebuilds only when forced.
  const { includeOnly } = options;
  const pretex = `${options.capturesSectionState ? `\\RequirePackage{${SECTION_STATE_PACKAGE}}` : ""}${includeOnly !== undefined ? `\\includeonly{${includeOnly}}` : ""}`;
  const partialArgs = [...(options.force || includeOnly !== undefined ? ["-g"] : []), ...(pretex !== "" ? [`-pretex=${pretex}`] : [])];
  const engine = toolchain.engine;
  return {
    executable: toolchain.executable,
    args: [
      // PLATFORM: latexmk runs a project `latexmkrc` as Perl; `-norc` skips every rc file, and all settings are on this command line.
      "-norc", LATEXMK_ENGINE[engine], "-interaction=nonstopmode", "-file-line-error", "-synctex=1",
      `-auxdir=${outDir}`, `-outdir=${outDir}`,
      // PLATFORM: latexmk has no flag for the engine's options; its command string is set from Perl. `-usepretex` would
      // replace that string, dropping the shell-escape guard; `%P` reads the pretex, and the job keeps main's name.
      "-e", `$${engine} = '${engine} ${NO_SHELL_ESCAPE}${options.haltOnError ? " -halt-on-error" : ""} -jobname=%R %O %P';`,
      ...(options.biber ? ["-e", createBiberAssignment(options.biber)] : []),
      ...partialArgs, mainFile,
    ],
    env: TEX_FILE_ACCESS_ENV,
  };
}
