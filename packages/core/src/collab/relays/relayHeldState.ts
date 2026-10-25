// Tracks the Yjs state a relay is known to hold for a doc, and encodes what a doc holds beyond it as one update.
// CONTRACT: documents/contracts/relay.md#clients
import * as Y from "yjs";

export const emptyHeld = (): Y.Snapshot => Y.createSnapshot(Y.createDeleteSet(), new Map());

/** Undefined when the saved bytes do not decode, so the caller treats the held state as unknown. */
export function decodeHeld(bytes: Uint8Array): Y.Snapshot | undefined {
  try { return Y.decodeSnapshot(bytes); } catch { return undefined; }
}

/** Grows `held` by an update the relay holds; the delete set stays sorted and merged, as `equalDeleteSets` needs. */
export function growHeld(held: Y.Snapshot, update: Uint8Array): Y.Snapshot {
  const sv = new Map(held.sv);
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update))) {
    sv.set(client, Math.max(clock, sv.get(client) ?? 0));
  }
  return Y.createSnapshot(Y.mergeDeleteSets([held.ds, Y.decodeUpdate(update).ds]), sv);
}

/** What `doc` holds beyond `expected`, as one update; undefined when nothing. */
export function missingUpdate(doc: Y.Doc, expected: Y.Snapshot): Uint8Array | undefined {
  const local = Y.snapshot(doc);
  const newerClock = [...local.sv].some(([client, clock]) => clock > (expected.sv.get(client) ?? 0));
  // TRAP: a delete adds no clock, so a delete-only edit shows only in the delete set.
  const newerDelete = !Y.equalDeleteSets(Y.mergeDeleteSets([expected.ds, local.ds]), expected.ds);
  if (!newerClock && !newerDelete) { return undefined; }
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(expected.sv));
}
