// Decides whether a file is text that can have a merge base, and declares the device-local text history that holds those bases.
import type { LibraryFileSystem } from "../../ports/index.js";

const MERGEABLE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".md", ".yaml", ".json", ".sty", ".cls", ".txt", ".csv", ".qmd"]);

/** A qmd item file, which merges item by item rather than line by line. */
export function isItemFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".qmd");
}

/** Checked before a file is read, so binary project files are never loaded to be rejected. */
export function hasMergeableExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 && MERGEABLE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Binary and non-UTF-8 files have no base: a line merge of them would corrupt the file. */
export function isMergeableTextFile(fileName: string, bytes: Uint8Array): boolean {
  return hasMergeableExtension(fileName) && isValidUtf8(bytes);
}

export interface ProjectWriteTracking {
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
