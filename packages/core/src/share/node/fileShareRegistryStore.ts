// Backs the device's share list with its shares.json file in the state dir, replacing it atomically on every write.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "../../library/node/index.js";
import type { ShareRegistryStore } from "../shareRegistry.js";

const sections = new Map<string, Promise<unknown>>();

// CONTRACT: documents/contracts/share-link.md#share-list
// TRAP: the section chain lives in this process, so two VS Code windows over one library are not serialized.
function exclusiveOn(file: string): ShareRegistryStore["exclusive"] {
  return (run) => {
    const next = (sections.get(file) ?? Promise.resolve()).then(run, run);
    sections.set(file, next.catch(() => undefined));
    return next;
  };
}

export function fileShareRegistryStore(file: string): ShareRegistryStore {
  return {
    read: async () => {
      try {
        return await fs.readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
        throw error;
      }
    },
    write: (text) => writeFileAtomic(file, text),
    exclusive: exclusiveOn(path.resolve(file)),
  };
}
