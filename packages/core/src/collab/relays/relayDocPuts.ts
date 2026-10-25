// Sends a doc lane's pending updates to the relay as sealed puts, at most one per window.
import * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { RelayStore } from "../transport/index.js";
import { MESSAGE_KIND, type SessionScheduler } from "../peer/index.js";
import type { RelayDocLane } from "./relayDocLane.js";

const LOG_MODULE = "collab.relay";
/** At most one put per doc in this window while the user types; the window's end is also the idle flush. */
export const PUT_INTERVAL_MS = 2000;

export interface RelayDocPutsOptions {
  relay: RelayStore;
  shareId: string;
  logger: ILogger;
  scheduler: SessionScheduler;
  seal: (lane: RelayDocLane, kind: typeof MESSAGE_KIND.update, payload: Uint8Array) => Promise<{ doc: string; frame: Uint8Array }>;
}

export class RelayDocPuts {
  constructor(private options: RelayDocPutsOptions) {}

  /** Opens the put window of a lane that has pending updates and none running. */
  schedule(lane: RelayDocLane): () => void {
    return this.options.scheduler.after(PUT_INTERVAL_MS, () => { lane.cancelFlush = undefined; void this.flush(lane); });
  }

  async flush(lane: RelayDocLane): Promise<void> {
    const { relay, logger, shareId } = this.options;
    lane.cancelFlush?.();
    lane.cancelFlush = undefined;
    if (lane.pending.length === 0 || !relay.connected) { return; }
    const update = lane.pending.length === 1 ? lane.pending[0]! : Y.mergeUpdates(lane.pending);
    lane.pending = [];
    // TRAP: sealing takes real time, so updates typed meanwhile wait for a window that starts at the put, not at this call.
    const sealing = () => {};
    lane.cancelFlush = sealing;
    let retryLater = false;
    try {
      const { doc, frame } = await this.options.seal(lane, MESSAGE_KIND.update, update);
      const sent = relay.request({ type: "put", doc, frame });
      if (sent) { lane.outstanding.push({ type: "put", update }); } else { lane.pending.unshift(update); }
      retryLater = sent;
    } catch (error) {
      // The update stays pending, and the next window retries it instead of spinning on a failing key.
      lane.pending.unshift(update);
      retryLater = true;
      void logger.error(LOG_MODULE, error, { shareId, docKey: lane.docKey });
    } finally {
      if (lane.cancelFlush === sealing) { lane.cancelFlush = retryLater && lane.pending.length > 0 ? this.schedule(lane) : undefined; }
    }
  }
}
