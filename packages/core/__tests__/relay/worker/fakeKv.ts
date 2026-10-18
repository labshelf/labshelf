// Stands in for a Workers KV namespace with a map, keeping the stream reads and the 25 MiB value limit of the real one.
import type { KvNamespace } from "../../../src/relay/worker/index";

export const KV_VALUE_LIMIT = 25 * 1024 * 1024;

export function fakeKv(): KvNamespace & { entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>();
  return {
    entries,
    get: async (key) => {
      const value = entries.get(key);
      return value ? new Response(value.slice()).body : null;
    },
    put: async (key, value) => {
      if (value.byteLength > KV_VALUE_LIMIT) { throw new Error("KV PUT failed: 413 Value too large"); }
      entries.set(key, new Uint8Array(value.slice(0)));
    },
    delete: async (key) => { entries.delete(key); },
  };
}
