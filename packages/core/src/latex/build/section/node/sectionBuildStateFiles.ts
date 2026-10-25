/** Puts the section state package into a build folder before a full build and reads the states that build recorded. */
import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../../../library/node/index.js";
import type { ILogger } from "../../../../ports/index.js";
import { parseSectionBuildStates, type SectionState } from "../sectionBuildStateFile.js";
import { SECTION_STATE_PACKAGE, deriveSectionBuildStateFileName, createSectionBuildStatePackage } from "../sectionBuildStatePackage.js";

const MODULE = "writing/build";

/** The engine finds the package in its output folder, so the project's files stay untouched. */
export async function writeSectionBuildStatePackage(outDir: string): Promise<void> {
  await writeFileAtomic(path.join(outDir, `${SECTION_STATE_PACKAGE}.sty`), createSectionBuildStatePackage());
}

/** The states of the last full build of `jobName`, in source order; none when no full build wrote them. */
export async function readSectionBuildStates(outDir: string, jobName: string, logger: ILogger): Promise<SectionState[]> {
  const file = path.join(outDir, deriveSectionBuildStateFileName(jobName));
  const text = await readOptionalFile(file);
  if (text === undefined) {
    await logger.log("INFO", MODULE, "LaTeX build has no section state yet", { file });
    return [];
  }
  const { states, skipped } = parseSectionBuildStates(text);
  if (skipped > 0) { await logger.log("WARN", MODULE, "LaTeX section state has unreadable lines", { file, skipped, states: states.length }); }
  return states;
}
