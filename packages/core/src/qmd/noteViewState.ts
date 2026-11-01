// What a host remembers of how a note is shown (plan D9): the collapsed cells and sections and Reading mode. View state only, never the document.
const MAX_ENTRIES = 500;

/** The collapsed cells (fold keys), the collapsed sections (section keys) and Reading mode of one note item. */
export interface NoteViewState { readonly cells: readonly string[]; readonly sections: readonly string[]; readonly reading: boolean }

/** The host's store of view state, keyed per note and item (`${noteKey}\n${itemId}`); `load` returns whatever was saved, unchecked. */
export interface QmdViewStatePort { load(key: string): unknown; save(key: string, state: NoteViewState): void }

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_ENTRIES) : [];

/** Whatever a store hands back as a NoteViewState: string-only entries, at most 500 of each list, reading false unless it is true. */
export function normaliseNoteViewState(value: unknown): NoteViewState {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { cells: strings(record.cells), sections: strings(record.sections), reading: record.reading === true };
}
