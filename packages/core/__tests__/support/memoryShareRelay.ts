/** An in-memory owner relay for share links and an in-memory share list, for tests of upload, revoke, open and import. */
import type { ShareBackend, ShareReader, ShareRegistryStore } from "../../src/share/index";

export function memoryShareRelay() {
  const manifests = new Map<string, Uint8Array>();
  const blobs = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const backend: ShareBackend = {
    putManifest: async (id, bytes) => { manifests.set(id, bytes); },
    putBlob: async (_id, hash, bytes) => { puts.push(hash); blobs.set(hash, bytes); },
    hasBlob: async (_id, hash) => blobs.has(hash),
    deleteManifest: async (id) => { manifests.delete(id); },
    deleteBlob: async (_id, hash) => { blobs.delete(hash); },
  };
  const reader: ShareReader = {
    fetchManifest: async (id) => manifests.get(id),
    fetchBlob: async (_id, hash) => blobs.get(hash),
  };
  return { backend, reader, manifests, blobs, puts };
}

/** `exclusive` chains its sections like the file store does. */
export function memoryShareRegistry(initial?: string): ShareRegistryStore & { text: string | undefined } {
  let tail: Promise<unknown> = Promise.resolve();
  const store = {
    text: initial,
    read: async () => store.text,
    write: async (text: string) => { store.text = text; },
    exclusive: <T>(run: () => Promise<T>): Promise<T> => {
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
  };
  return store;
}
