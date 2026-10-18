// Builds a project catalog context over an in-memory file system and an in-memory folder registry.
import { posixPathOps, type ProjectCatalogContext, type ProjectFolderRegistry } from "@labshelf/core";

import { fakeLogger, type RecordingLogger } from "./fakeLogger";
import { MemoryLibraryFs } from "./memoryLibraryFs";

export const LIB = "/lib";

export class MemoryProjectRegistry implements ProjectFolderRegistry {
  readonly byLibrary = new Map<string, string[]>();
  async folders(libraryRoot: string): Promise<readonly string[]> { return this.byLibrary.get(libraryRoot) ?? []; }
  async register(libraryRoot: string, folder: string): Promise<void> {
    const current = this.byLibrary.get(libraryRoot) ?? [];
    if (!current.includes(folder)) { this.byLibrary.set(libraryRoot, [...current, folder]); }
  }
  async unregister(libraryRoot: string, folder: string): Promise<void> {
    this.byLibrary.set(libraryRoot, (this.byLibrary.get(libraryRoot) ?? []).filter((entry) => entry !== folder));
  }
}

export interface MemoryCatalog extends ProjectCatalogContext {
  fs: MemoryLibraryFs;
  registry: MemoryProjectRegistry;
  logger: RecordingLogger;
}

export function memoryCatalog(fs: MemoryLibraryFs = new MemoryLibraryFs()): MemoryCatalog {
  return { fs, paths: posixPathOps, logger: fakeLogger(), registry: new MemoryProjectRegistry() };
}

/** Writes text files under a folder, keyed by path relative to it. */
export async function writeTree(fs: MemoryLibraryFs, folder: string, files: Record<string, string>): Promise<void> {
  for (const [name, text] of Object.entries(files)) { await fs.writeText(`${folder}/${name}`, text); }
}

export function readText(fs: MemoryLibraryFs, file: string): string {
  return new TextDecoder().decode(fs.files.get(file));
}

/** @returns the files under a folder, relative to it and sorted */
export function filesUnder(fs: MemoryLibraryFs, folder: string): string[] {
  return fs.fileList().filter((file) => file.startsWith(`${folder}/`)).map((file) => file.slice(folder.length + 1));
}
