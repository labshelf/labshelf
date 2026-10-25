// Rebuilds a LaTeX document after installing each TeX file the previous build missed.
import type { ILogger } from "../../../ports/index.js";
import type { TexProvider } from "../../../latex/toolchain/index.js";

const MODULE = "writing/build";
const MAX_INSTALL_ROUNDS = 10;

export interface InstallingCompile<R> {
  compile(round: { force: boolean }): Promise<R>;
  /** The TeX file the build missed, if any. */
  missingFile(result: R): string | undefined;
  tex: Pick<TexProvider, "installMissing">;
  logger: ILogger;
}

/** The last build's result: one without a missing file, one whose file could not be installed, or the one after the last allowed round. */
export async function buildInstallingPackages<R>(run: InstallingCompile<R>): Promise<R> {
  // TRAP: latexmk does not rerun a failed build whose sources are unchanged, so a rebuild after an install is forced.
  let result = await run.compile({ force: false });
  for (let round = 1; ; round++) {
    const fileName = run.missingFile(result);
    if (!fileName) { return result; }
    if (round > MAX_INSTALL_ROUNDS) {
      await run.logger.log("WARN", MODULE, "Stopped installing missing TeX files", { fileName, rounds: MAX_INSTALL_ROUNDS });
      return result;
    }
    const installed = await run.tex.installMissing(fileName);
    await run.logger.log(installed ? "INFO" : "WARN", MODULE, installed ? "Installed a missing TeX file" : "Could not install a missing TeX file", { fileName, round });
    if (!installed) { return result; }
    result = await run.compile({ force: true });
  }
}
