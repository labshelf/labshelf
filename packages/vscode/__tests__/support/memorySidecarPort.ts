/** An in-memory SidecarPort and a PaperSidecarStore over it, for tests that must not touch disk. */
import { PaperSidecarStore, type SidecarPort } from '@labshelf/core';

export function makeMemorySidecarPort(): SidecarPort {
  const files = new Map<string, string>();
  return {
    async read(paperId) { return files.get(paperId) ?? null; },
    async write(paperId, text) { files.set(paperId, text); },
  };
}

export function makeMemoryPaperDataStore(): PaperSidecarStore {
  return new PaperSidecarStore(makeMemorySidecarPort());
}
