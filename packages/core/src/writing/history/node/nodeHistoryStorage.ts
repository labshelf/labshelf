// Keeps a project's history log and content-addressed objects in a folder on disk.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { HistoryStorage } from "../historyStorage.js";

const HISTORY_LOG = "log.jsonl";
const HISTORY_OBJECTS = "objects";

export function nodeHistoryStorage(historyDir: string): HistoryStorage {
  const objectPath = (hash: string): string => path.join(historyDir, HISTORY_OBJECTS, hash.slice(0, 2), hash);
  return {
    async readLog() {
      return fs.readFile(path.join(historyDir, HISTORY_LOG), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") { return ""; }
        throw error;
      });
    },
    async appendLog(line) {
      await fs.mkdir(historyDir, { recursive: true });
      await fs.appendFile(path.join(historyDir, HISTORY_LOG), line);
    },
    hasObject: (hash) => fs.access(objectPath(hash)).then(() => true, () => false),
    readObject: (hash) => fs.readFile(objectPath(hash)),
    async writeObject(hash, bytes) {
      const target = objectPath(hash);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.tmp-${randomBytes(4).toString("hex")}`;
      await fs.writeFile(temp, bytes);
      await fs.rename(temp, target);
    },
  };
}
