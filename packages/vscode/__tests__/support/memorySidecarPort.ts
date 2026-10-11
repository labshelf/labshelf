/** An in-memory SidecarPort and a PaperDataStore over it, for tests that must not touch disk. */
import { PaperDataStore, type SidecarPort } from '@labshelf/core';

export function makeMemorySidecarPort(): SidecarPort {
  const files = new Map<string, string>();
  return {
    async read(paperId) { return files.get(paperId) ?? null; },
    async write(paperId, text) { files.set(paperId, text); },
  };
}

export function makeMemoryPaperDataStore(): PaperDataStore {
  return new PaperDataStore(makeMemorySidecarPort());
}
