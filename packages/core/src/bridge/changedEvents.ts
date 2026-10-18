/** Splits changed library paths into `changed` events whose frames each fit the host message limit. */
import { HOST_MESSAGE_LIMIT, type BridgeChangedEvent } from "./protocol.js";

// CONTRACT: documents/contracts/bridge.md#events
const EMPTY_EVENT_BYTES = JSON.stringify({ event: "changed", paths: [] }).length;

export function changedEvents(paths: string[]): BridgeChangedEvent[] {
  const encoder = new TextEncoder();
  const events: BridgeChangedEvent[] = [];
  let batch: string[] = [];
  let bytes = EMPTY_EVENT_BYTES;
  for (const changed of paths) {
    const pathBytes = encoder.encode(JSON.stringify(changed)).length;
    // A path after the first also costs its separating comma.
    if (batch.length > 0 && bytes + 1 + pathBytes > HOST_MESSAGE_LIMIT) {
      events.push({ event: "changed", paths: batch });
      batch = [];
      bytes = EMPTY_EVENT_BYTES;
    }
    bytes += (batch.length > 0 ? 1 : 0) + pathBytes;
    batch.push(changed);
  }
  if (batch.length > 0) events.push({ event: "changed", paths: batch });
  return events;
}
