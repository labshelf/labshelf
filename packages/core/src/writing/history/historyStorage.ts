// Declares the storage a project's history log and content-addressed file store live in, and what a history operates on.
import type { ProjectReadContext } from "../project/index.js";

export interface HistoryStorage {
  /** @returns the whole log, or "" when nothing was recorded yet */
  readLog(): Promise<string>;
  /** Appends one serialized line, creating the log when missing. */
  appendLog(line: string): Promise<void>;
  hasObject(hash: string): Promise<boolean>;
  readObject(hash: string): Promise<Uint8Array>;
  // INVARIANT: an object is written atomically, so a crash never leaves a truncated object under its hash.
  writeObject(hash: string, bytes: Uint8Array): Promise<void>;
}

/** A project folder, how to read and restore its files, and where its history is kept. */
export interface HistoryProject {
  project: Pick<ProjectReadContext, "fs" | "paths">;
  folder: string;
  storage: HistoryStorage;
}
