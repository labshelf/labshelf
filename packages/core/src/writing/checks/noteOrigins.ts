/** Reads the origin comments of a project's sources and lists those that are not fresh. */
import { deriveOriginState, readOriginLatex, scanOrigins, deriveOriginHash } from "../noteLinks/index.js";
import type { ChecklistSource } from "./checklist.js";

/** @returns the note's current equation hash, or undefined when the note or its label is gone */
export type OriginNoteReader = (notePath: string, label: string) => Promise<{ hash: string } | undefined>;

/** A manuscript equation whose copy differs from its note, or whose note is absent; fresh origins are not listed. */
export interface NoteOrigin {
  file: string;
  /** Zero-based line of the origin comment. */
  line: number;
  notePath: string;
  label: string;
  state: "stale" | "diverged" | "both" | "missing";
}

/** @returns the stale, diverged, both and missing origins of the sources, in source order */
export async function readNoteOrigins(sources: readonly ChecklistSource[], readNote: OriginNoteReader): Promise<NoteOrigin[]> {
  const origins: NoteOrigin[] = [];
  for (const source of sources) {
    for (const origin of scanOrigins(source.format, source.text)) {
      const manuscriptHash = await deriveOriginHash(readOriginLatex(source.format, source.text, origin));
      const state = deriveOriginState(origin, manuscriptHash, await readNote(origin.notePath, origin.label));
      if (state === "fresh") { continue; }
      origins.push({ file: source.path, line: origin.line, notePath: origin.notePath, label: origin.label, state });
    }
  }
  return origins;
}
