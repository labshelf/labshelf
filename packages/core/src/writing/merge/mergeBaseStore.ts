// Declares the port that keeps, per project text file, the content this device last knew to be common with other devices.

// CONTRACT: documents/contracts/sync.md#conflict-copies
/**
 * The store never deletes: a deleted project file keeps its base, so a conflict copy of it can still be merged.
 * Callers write a base only when a file is first seen with no base and after a merge writes the merged file,
 * never on a save or another change. A base that holds an own edit makes a three-way merge delete that edit;
 * a stale base only yields more conflict markers.
 */
export interface IMergeBaseStore {
  /** @returns the base of a project file, or undefined when it has none */
  read(projectId: string, relativePath: string): Promise<string | undefined>;
  write(projectId: string, relativePath: string, text: string): Promise<void>;
}
