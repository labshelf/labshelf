/** Picks the one-pass preview command of a LaTeX build, with the preamble format when one is available, or none when no full build has written its `.aux` yet. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import type { LatexToolchain } from "../../toolchain/index.js";
import type { BuildCommand } from "../index.js";
import { latexPreviewCommand } from "../index.js";
import { preambleFormat } from "./preambleFormat/index.js";

export interface PreviewPlanInput {
  toolchain: LatexToolchain;
  projectFolder: string;
  main: string;
  /** The user's explicit include-only selection. */
  includeOnly?: string;
  outDir: string;
  signal: AbortSignal;
  logger: ILogger;
}

export interface PreviewPlan {
  command: BuildCommand;
  /** The chapter to hand the format through the include-only file; the command carries it when no format is used. */
  includeOnlyFile: string | undefined;
}

const MODULE = "writing/build";

export async function planLatexPreview(input: PreviewPlanInput): Promise<PreviewPlan | undefined> {
  const base = path.basename(input.main, path.extname(input.main));
  const aux = path.join(input.outDir, `${base}.aux`);
  if (!await fs.stat(aux).then(() => true, () => false)) {
    await input.logger.log("INFO", MODULE, "LaTeX preview falls back to a full build: no .aux yet", { main: input.main, aux });
    return undefined;
  }
  const includeOnly = input.includeOnly;
  const mainPath = path.join(input.projectFolder, input.main);
  const found = await preambleFormat({ ...input, mainPath });
  const format = found && { name: found.name, searchPath: `${found.dir}${path.delimiter}` };
  const command = latexPreviewCommand(input.toolchain.engine, path.basename(input.main), input.outDir, { includeOnly, format });
  return { command, includeOnlyFile: format ? includeOnly : undefined };
}
