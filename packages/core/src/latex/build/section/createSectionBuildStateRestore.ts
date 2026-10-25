/** Renders the TeX that sets every counter to its value before a captured section, so the section typesets alone with its real numbers. */
import type { SectionState } from "./sectionBuildStateFile.js";

/** A counter the section's own document never defines, e.g. one a later `\newcounter` creates, is skipped instead of failing. */
export function createSectionBuildStateRestore(state: SectionState): string {
  return Object.entries(state.counters)
    .map(([name, value]) => `\\ifcsname c@${name}\\endcsname\\setcounter{${name}}{${value}}\\fi\n`)
    .join("");
}
