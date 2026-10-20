// Loads every stored doc of a share as one Yjs update each, compacting a doc whose log holds updates or a torn tail.
import * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { CollabStateStorage } from "./collabStateStorage.js";

const LOG_MODULE = "collab.state";

/** By doc id; the log of each doc is merged into its snapshot, so the log only ever holds what came after this load. */
export async function loadStoredDocStates(storage: CollabStateStorage, logger: ILogger): Promise<Map<string, Uint8Array>> {
  const states = new Map<string, Uint8Array>();
  for (const [docId, { snapshot, updates, torn }] of await storage.loadDocs()) {
    if (torn) { await logger.log("WARN", LOG_MODULE, "Dropped a torn final record of a doc log", { docId }); }
    if (updates.length === 0 && !torn) {
      if (snapshot) { states.set(docId, snapshot); }
      continue;
    }
    const merged = Y.mergeUpdates(snapshot ? [snapshot, ...updates] : updates);
    await storage.compactDoc(docId, merged);
    await logger.log("INFO", LOG_MODULE, "Compacted a doc log into its snapshot", { docId, records: updates.length });
    states.set(docId, merged);
  }
  return states;
}
