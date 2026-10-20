// Stores the updates of one doc in order, and stores its full state instead after a write of it failed.
import * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { CollabStateStorage } from "./collabStateStorage.js";

const LOG_MODULE = "collab.state";

export interface DocPersistenceOptions {
  storage: CollabStateStorage;
  docId: string;
  docKey: string;
  logger: ILogger;
  /** Updates with this origin are already stored. */
  storedOrigin: unknown;
}

export interface DocPersistence {
  readonly docKey: string;
  /** True while an update of the doc is not known to be stored. */
  readonly unstored: boolean;
  /** Queues a full-state write when an update is not stored. */
  retry(): void;
  /** Resolves when every write queued so far has settled. */
  settled(): Promise<void>;
  stop(): void;
}

export function persistDoc(doc: Y.Doc, { storage, docId, docKey, logger, storedOrigin }: DocPersistenceOptions): DocPersistence {
  let chain = Promise.resolve();
  let seen = 0;
  let stored = 0;
  // INVARIANT: after a failed write the log may end in a partial record, so nothing is appended until a full-state
  // write replaces the log; this keeps a torn record the last one and keeps every later update out of the gap.
  let failed = false;

  const write = async (update: Uint8Array | undefined, seq: number) => {
    if (seq <= stored) { return; }
    const whole = failed || !update;
    try {
      if (whole) {
        const covered = seen;
        await storage.compactDoc(docId, Y.encodeStateAsUpdate(doc));
        stored = covered;
        failed = false;
        await logger.log("INFO", LOG_MODULE, "Stored the full state of a doc after a failed write", { docKey, docId });
      } else {
        await storage.appendUpdate(docId, update);
        stored = seq;
      }
    } catch (error) {
      failed = true;
      await logger.error(LOG_MODULE, error, { docKey, docId, action: whole ? "store doc state" : "append doc update" });
    }
  };
  const enqueue = (update: Uint8Array | undefined, seq: number) => { chain = chain.then(() => write(update, seq)); };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === storedOrigin) { return; }
    seen += 1;
    enqueue(update, seen);
  };
  doc.on("update", onUpdate);

  return {
    docKey,
    get unstored() { return stored < seen; },
    retry: () => { if (stored < seen) { enqueue(undefined, seen); } },
    settled: async () => {
      let current: Promise<void>;
      do { current = chain; await current; } while (current !== chain);
    },
    stop: () => doc.off("update", onUpdate),
  };
}
