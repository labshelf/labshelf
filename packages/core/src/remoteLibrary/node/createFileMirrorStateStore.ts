// Backs the mirror hash table with its mirror.json file in the library's device-local state dir.
import { parseMirrorState, serializeMirrorState, type MirrorStateStore } from "../mirrorState.js";

/** `writeText` must replace the file atomically; `readText` answers undefined and `remove` succeeds for a missing file. */
export function createFileMirrorStateStore(file: string, fs: { readText(path: string): Promise<string | undefined>; writeText(path: string, text: string): Promise<void>; remove(path: string): Promise<void> }): MirrorStateStore {
  return {
    read: async () => {
      const text = await fs.readText(file);
      return text === undefined ? undefined : parseMirrorState(text);
    },
    write: (state) => fs.writeText(file, serializeMirrorState(state)),
    clear: () => fs.remove(file),
  };
}
