/** Assembles the document that typesets one section alone on the main file's precompiled preamble format. */
import { createSectionBuildStateRestore } from "./createSectionBuildStateRestore.js";
import type { SectionState } from "./sectionBuildStateFile.js";

export interface SectionDocumentInput {
  /** The format dumped from the main file's preamble, without extension. */
  formatName: string;
  definitions: readonly string[];
  state: SectionState;
  sectionText: string;
}

export interface SectionDocument {
  text: string;
  /** Lines before the section text: a problem on document line L is on source line L − headerLines + the section's start line. */
  headerLines: number;
}

// INVARIANT: the job's own aux holds the full build's filtered aux; `\begin{document}` reads it while preamble-only
// commands such as `\newlabel` still work, and before the restore, whose values its `\@setckpt` lines would overwrite.
// The definitions come before the restore too, because `\newcounter` and `\newtheorem` reset counters.
export function createSectionDocument(input: SectionDocumentInput): SectionDocument {
  const header = `%&${input.formatName}\n\\begin{document}\n`
    + input.definitions.map((definition) => `${definition}\n`).join("")
    + createSectionBuildStateRestore(input.state);
  return { text: `${header}${input.sectionText}\n\\end{document}\n`, headerLines: header.split("\n").length - 1 };
}
