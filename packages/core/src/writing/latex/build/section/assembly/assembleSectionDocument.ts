/** Assembles the document that typesets one section alone on the main file's precompiled preamble format. */
import { restoreSectionState } from "../restoreSectionState.js";
import type { SectionState } from "../sectionStateFile.js";

export interface SectionDocumentInput {
  /** The format dumped from the main file's preamble, without extension. */
  formatName: string;
  /** A copy of the full build's aux, filtered by `filterAuxForSection`. */
  auxCopyName: string;
  definitions: readonly string[];
  state: SectionState;
  sectionText: string;
}

export interface SectionDocument {
  text: string;
  /** Lines before the section text: a problem on document line L is on source line L − headerLines + the section's start line. */
  headerLines: number;
}

// INVARIANT: the aux and the definitions come before the restore: the aux's `\@input{chap.aux}` runs `\@setckpt`,
// and `\newcounter` or `\newtheorem` reset counters, so either would overwrite the restored values.
export function assembleSectionDocument(input: SectionDocumentInput): SectionDocument {
  const header = `%&${input.formatName}\n\\begin{document}\n`
    + `\\makeatletter\\input{${input.auxCopyName}}\\makeatother\n`
    + input.definitions.map((definition) => `${definition}\n`).join("")
    + restoreSectionState(input.state);
  return { text: `${header}${input.sectionText}\n\\end{document}\n`, headerLines: header.split("\n").length - 1 };
}
