// Converts a project's main file to a Word, Markdown or HTML document with the pandoc on PATH.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { findExecutable } from "../../../latex/toolchain/node/index.js";
import type { ProjectFormat } from "../../projectFile.js";
import { pandocArgs, type DocumentExport } from "../pandocArgs.js";

const run = promisify(execFile);

export const PANDOC_MISSING_MESSAGE = "Exporting to Word, Markdown or HTML needs pandoc. Install it from https://pandoc.org, then try again.";

export interface PandocRequest {
  format: ProjectFormat;
  /** The project folder; pandoc runs in it. */
  folder: string;
  /** The main file, relative to `folder`. */
  main: string;
  target: DocumentExport;
  output: string;
}

/** @throws with PANDOC_MISSING_MESSAGE when pandoc is not on PATH, or with pandoc's error output when it fails */
export async function convertWithPandoc(request: PandocRequest): Promise<void> {
  const pandoc = await findExecutable("pandoc");
  if (!pandoc) { throw new Error(PANDOC_MISSING_MESSAGE); }
  try {
    await run(pandoc, pandocArgs(request.format, request.main, request.target, request.output), { cwd: request.folder });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`pandoc failed on ${request.main}${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
}
