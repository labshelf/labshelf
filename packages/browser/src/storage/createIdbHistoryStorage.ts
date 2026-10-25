// Keeps a project's history log and its content-addressed file store in IndexedDB.
import type { HistoryStorage } from "@labshelf/core";
import { openDb } from "./idbDatabase";

export function createIdbHistoryStorage(projectId: string): HistoryStorage {
  return {
    async readLog() {
      return (await (await openDb()).get("historyLog", projectId))?.text ?? "";
    },
    async appendLog(line) {
      // INVARIANT: `line` ends with a newline, as serializeHistoryLine writes it.
      // One readwrite transaction, so two appends never both read the same log and drop one line.
      const tx = (await openDb()).transaction("historyLog", "readwrite");
      const text = (await tx.store.get(projectId))?.text ?? "";
      await tx.store.put({ projectId, text: `${text}${line}` });
      await tx.done;
    },
    async hasObject(hash) {
      return (await (await openDb()).get("historyObjects", hash)) !== undefined;
    },
    async readObject(hash) {
      const row = await (await openDb()).get("historyObjects", hash);
      if (!row) throw new Error(`The history of ${projectId} has no stored file ${hash}`);
      return row.bytes;
    },
    async writeObject(hash, bytes) {
      await (await openDb()).put("historyObjects", { hash, bytes });
    },
  };
}
