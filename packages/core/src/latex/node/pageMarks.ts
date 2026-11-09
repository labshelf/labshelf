/** Writes the page marks package into a build folder and reads the page map a full build left there. */
import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import {
  createPageMarksPackage, type DeckPageMap, derivePageMarksFileName, listFramedBlockFiles, PAGE_MARKS_PACKAGE, parseDeckPageMap, placeFramedBlocks,
} from "../pageMarks.js";

const MODULE = "writing/build";

/** The engine finds the package in its output folder, so the project's files stay untouched. */
export async function writePageMarksPackage(outDir: string): Promise<void> {
  await writeFileAtomic(path.join(outDir, `${PAGE_MARKS_PACKAGE}.sty`), createPageMarksPackage());
}

/** The page map of the last full build of `jobName`; none when it wrote no marks. `workDir` is the main file's folder, which the marks' files are relative to. */
export async function readDeckPageMap(outDir: string, jobName: string, workDir: string, logger: ILogger): Promise<DeckPageMap | undefined> {
  const file = path.join(outDir, derivePageMarksFileName(jobName));
  const text = await readOptionalFile(file);
  if (text === undefined) { return undefined; }
  const sources = new Map<string, string>();
  for (const name of listFramedBlockFiles(text)) {
    const source = await readOptionalFile(path.join(workDir, name));
    if (source === undefined) { await logger.log("WARN", MODULE, "LaTeX page map names a frame file that cannot be read", { file: name }); } else { sources.set(name, source); }
  }
  return parseDeckPageMap(placeFramedBlocks(text, sources));
}
