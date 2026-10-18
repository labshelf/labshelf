// Backs the device's share list with its shares.json file in the state dir, replacing it atomically on every write.
import { promises as fs } from "node:fs";

import { writeFileAtomic } from "../../library/node/index.js";
import type { ShareRegistryStore } from "../shareRegistry.js";

// CONTRACT: documents/contracts/share-link.md#share-list
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
  };
}
