/** Builds the command line of a preview: one engine pass over a LaTeX main file, optionally typesetting one chapter. */

import type { LatexToolchain } from "../toolchain/index.js";
import type { BuildCommand } from "./latexBuildCommand.js";
import { NO_SHELL_ESCAPE, TEX_FILE_ACCESS_ENV } from "./texSandbox.js";

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
export function latexPreviewCommand(engine: LatexToolchain["engine"], mainFile: string, outDir: string, options: PreviewOptions = {}): BuildCommand {
  const { includeOnly, format, haltOnError } = options;
  const base = mainFile.replace(/\.tex$/, "");
  // PLATFORM: a mylatexformat format discards the first input up to `\begin{document}`, so main must be that input.
  const source = includeOnly === undefined || format ? [mainFile] : [`-jobname=${base}`, `\\includeonly{${includeOnly}}\\input{${mainFile}}`];
  const common = ["-interaction=nonstopmode", "-file-line-error", "-synctex=1", NO_SHELL_ESCAPE, ...(haltOnError ? ["-halt-on-error"] : []), `-output-directory=${outDir}`, ...source];
  if (!format) { return { executable: engine, args: common, env: TEX_FILE_ACCESS_ENV }; }
  return { executable: engine, args: [`-fmt=${format.name}`, ...common], env: { ...TEX_FILE_ACCESS_ENV, TEXFORMATS: format.searchPath } };
}
