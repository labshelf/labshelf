// Declares device-local project text history for divergence detection and conflict-copy merging.
import type { LibraryFileSystem } from "../../ports/index.js";

export interface ProjectSaveTracking {
  fs: LibraryFileSystem;
  beforeSave(file: string, text: string): Promise<void>;
  afterSave(file: string, text: string): Promise<void>;
}

export interface IProjectVersionStore {
  /** Reads the common ancestor used for named conflict copies. */
  read(projectId: string, relativePath: string): Promise<string | undefined>;
  write(projectId: string, relativePath: string, text: string): Promise<void>;
  versions(projectId: string, relativePath: string): Promise<string[]>;
  latest(projectId: string, relativePath: string): Promise<string | undefined>;
  version(projectId: string, relativePath: string, hash: string): Promise<string | undefined>;
  retain(projectId: string, relativePath: string, text: string): Promise<void>;
  remember(projectId: string, relativePath: string, text: string): Promise<void>;
  pending(projectId: string, relativePath: string): Promise<string | undefined>;
  setPending(projectId: string, relativePath: string, copy: string | undefined): Promise<void>;
}
