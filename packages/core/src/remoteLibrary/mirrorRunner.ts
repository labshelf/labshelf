/** One mirror run: take the writer lease, hash the selected files, diff them against the device's hash table, send the
 * changed rows in batches under 1 MiB, then delete the rows that disappeared. The table is written after every accepted
 * batch, so a relay failure or the per-run cap leaves a resumable state and the next run finishes the rest. */
import type { MirrorPut, MirrorRelay } from "./mirrorRelay.js";
import type { MirrorFile, MirrorSelection } from "./mirrorSelection.js";
import { stateForRelay, type MirrorRow, type MirrorState, type MirrorStateStore } from "./mirrorState.js";

export interface MirrorRunResult { status: "synced" | "partial" | "skipped"; uploaded: number; deleted: number; skipped: { path: string; reason: string }[] }

const DEFAULT_CAP = 400;
/** A request body stays under 1 MiB; the margin covers the JSON envelope. */
const BATCH_BYTES = 1024 * 1024 - 4096;
const encoder = new TextEncoder();

interface Pending { put: MirrorPut }

function errorReason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Splits items into runs whose summed weight stays within the batch size; an item over it alone goes in `oversize`. */
function batches<T>(items: T[], weight: (item: T) => number): { groups: T[][]; oversize: T[] } {
  const groups: T[][] = [];
  const oversize: T[] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = weight(item);
    if (itemBytes > BATCH_BYTES) { oversize.push(item); continue; }
    if (current.length > 0 && bytes + itemBytes > BATCH_BYTES) { groups.push(current); current = []; bytes = 0; }
    current.push(item);
    bytes += itemBytes;
  }
  if (current.length > 0) { groups.push(current); }
  return { groups, oversize };
}

const putWeight = (put: MirrorPut): number => encoder.encode(JSON.stringify(put)).byteLength + 1;
const pathWeight = (path: string): number => encoder.encode(JSON.stringify(path)).byteLength + 1;

export function createMirrorRunner(deps: { select(): Promise<MirrorSelection>; relay: MirrorRelay; state: MirrorStateStore; relayUrl: string; hash(text: string): Promise<string>; cap?: number }): { run(): Promise<MirrorRunResult> } {
  const cap = deps.cap ?? DEFAULT_CAP;

  /** Hashes each file; the text is kept only for the first `cap` changed ones, which are all a run can send. */
  async function diff(files: MirrorFile[], rows: Record<string, MirrorRow>, skipped: MirrorRunResult["skipped"]): Promise<{ changed: Pending[]; overCap: boolean; present: Set<string> }> {
    const changed: Pending[] = [];
    const present = new Set<string>();
    let overCap = false;
    for (const file of files) {
      present.add(file.path);
      let text: string;
      let hash: string;
      try {
        text = await file.read();
        hash = await deps.hash(text);
      } catch (error) {
        skipped.push({ path: file.path, reason: errorReason(error, "The file could not be read.") });
        continue;
      }
      if (rows[file.path]?.hash === hash) { continue; }
      if (changed.length >= cap) { overCap = true; continue; }
      changed.push({ put: { path: file.path, kind: file.kind, hash, size: encoder.encode(text).byteLength, value: text } });
    }
    return { changed, overCap, present };
  }

  async function send(state: MirrorState, changed: Pending[], gone: string[], skipped: MirrorRunResult["skipped"]): Promise<{ uploaded: number; deleted: number; complete: boolean }> {
    const result = { uploaded: 0, deleted: 0, complete: true };
    let first = true;
    const renewed = async (): Promise<boolean> => {
      if (first) { first = false; return true; }
      return deps.relay.lease("renew");
    };

    const puts = batches(changed.map((entry) => entry.put), putWeight);
    for (const put of puts.oversize) { skipped.push({ path: put.path, reason: "The file is too large for one relay request." }); }
    try {
      for (const group of puts.groups) {
        if (!await renewed()) { result.complete = false; return result; }
        await deps.relay.putRows(group, []);
        for (const put of group) { state.rows[put.path] = { hash: put.hash, size: put.size, kind: put.kind }; }
        await deps.state.write(state);
        result.uploaded += group.length;
      }
      for (const group of batches(gone, pathWeight).groups) {
        if (!await renewed()) { result.complete = false; return result; }
        await deps.relay.putRows([], group);
        for (const path of group) { delete state.rows[path]; }
        await deps.state.write(state);
        result.deleted += group.length;
      }
    } catch {
      // A relay or table failure keeps the batches already accepted; the next run resumes from the table.
      result.complete = false;
    }
    return result;
  }

  async function synchronise(skipped: MirrorRunResult["skipped"]): Promise<MirrorRunResult> {
    const stored = await deps.state.read();
    const state = stateForRelay(stored, deps.relayUrl);
    const selection = await deps.select();
    skipped.push(...selection.skipped);
    const { changed, overCap, present } = await diff(selection.files, state.rows, skipped);
    const gone = overCap ? [] : Object.keys(state.rows).filter((path) => !present.has(path));
    const sent = await send(state, changed, gone, skipped);
    const complete = sent.complete && !overCap;
    return { status: complete ? "synced" : "partial", uploaded: sent.uploaded, deleted: sent.deleted, skipped };
  }

  return {
    async run() {
      const skipped: MirrorRunResult["skipped"] = [];
      let held: boolean;
      try {
        held = await deps.relay.lease("acquire");
      } catch {
        return { status: "skipped", uploaded: 0, deleted: 0, skipped };
      }
      if (!held) { return { status: "skipped", uploaded: 0, deleted: 0, skipped }; }
      try {
        return await synchronise(skipped);
      } finally {
        await deps.relay.lease("release").catch(() => undefined);
      }
    },
  };
}
