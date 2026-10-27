/** Builds the command lines of a LaTeX build and its preview, runs them in a sandbox that keeps untrusted sources from running programs, and describes the build's outcome. */
import { createBiberAssignment, type BiberCommand } from "./biber.js";
import type { BuildProblem } from "./log/index.js";
import { SECTION_STATE_PACKAGE } from "./sectionState.js";
import type { LatexToolchain } from "./toolchain.js";

export type LocatedProblem = Omit<BuildProblem, "file"> & { file: string };

export type LatexBuildResult =
  | { status: "cancelled" }
  | { status: "succeeded"; pdf: string; problems: LocatedProblem[] }
  | { status: "failed"; problems: LocatedProblem[] };

export const NO_SHELL_ESCAPE = "-no-shell-escape";

// PLATFORM: `p` (paranoid) lets TeX write only below the working folder and `-output-directory`, and read only there or
// in the TeX tree; absolute and parent paths, and dotfiles, are refused.
export const TEX_FILE_ACCESS_ENV: Record<string, string> = { openout_any: "p", openin_any: "p" };

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

interface PreviewFormat {
  /** The precompiled preamble format, passed as `-fmt`. */
  name: string;
  /** The TEXFORMATS value that finds it; the environment keeps a folder with spaces off the command line. */
  searchPath: string;
}

export interface PreviewOptions {
  /** An `\include` argument as written; ignored with a format, which reads it from a file instead. */
  includeOnly?: string | undefined;
  format?: PreviewFormat | undefined;
  /** Stops the engine at the first error instead of continuing. */
  haltOnError?: boolean | undefined;
}

/**
 * Runs the engine by name; the build's PATH starts with the toolchain folder.
 * Without a format, the main file is `\input` under its own job name after `\includeonly`, so the source stays unchanged
 * and the other chapters keep the numbering of their `.aux` files.
 */
export function createLatexPreviewCommand(engine: LatexToolchain["engine"], mainFile: string, outDir: string, options: PreviewOptions = {}): BuildCommand {
  const { includeOnly, format, haltOnError } = options;
  const base = mainFile.replace(/\.tex$/, "");
  // PLATFORM: a mylatexformat format discards the first input up to `\begin{document}`, so main must be that input.
  const source = includeOnly === undefined || format ? [mainFile] : [`-jobname=${base}`, `\\includeonly{${includeOnly}}\\input{${mainFile}}`];
  const common = ["-interaction=nonstopmode", "-file-line-error", "-synctex=1", NO_SHELL_ESCAPE, ...(haltOnError ? ["-halt-on-error"] : []), `-output-directory=${outDir}`, ...source];
  if (!format) { return { executable: engine, args: common, env: TEX_FILE_ACCESS_ENV }; }
  return { executable: engine, args: [`-fmt=${format.name}`, ...common], env: { ...TEX_FILE_ACCESS_ENV, TEXFORMATS: format.searchPath } };
}
