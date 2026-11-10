/** One mirror run: take the writer lease, read the Mirror's status, apply the edits made on /open/, hash the selected
 * files, diff them against the device's hash table, leave out what would pass the storage limit, send small text rows in
 * JSON batches and every other row as its own file, then delete the rows that disappeared. The table is written after
 * every accepted request, so a relay failure, a `full` refusal or the per-run cap leaves a resumable state. */
import { deriveTextSha256Hex } from "../hash/index.js";
import { applyMirrorEdits, type MirrorEditFiles, type MirrorEditsResult } from "./mirrorEdits.js";
import { MirrorRefusal, type MirrorPut, type MirrorRelay, type MirrorStatus, type MirrorStore } from "./mirrorRelay.js";
import { MAX_MIRROR_FILE_BYTES, type MirrorFile, type MirrorSelection } from "./mirrorSelection.js";
import { stateForMirror, type MirrorRow, type MirrorState, type MirrorStateStore } from "./mirrorState.js";

/** `leftOut` lists the files not sent because the Mirror is full or would pass its limit; `warn` is used ≥ 90% of the limit. */
export interface MirrorStorage { store: MirrorStore; used: number; limit: number; warn: boolean; full: boolean; leftOut: string[] }
/** `edits` and `storage` are missing on a skipped run, which never read the status. */
export interface MirrorRunResult {
  status: "synced" | "partial" | "skipped"; uploaded: number; deleted: number; skipped: { path: string; reason: string }[];
  edits?: MirrorEditsResult; storage?: MirrorStorage;
}

export interface MirrorRunnerDeps {
  select(options: { includePdfs: boolean }): Promise<MirrorSelection>;
  relay: MirrorRelay;
  state: MirrorStateStore;
  /** The library files the edits made on /open/ are written to. */
  files: MirrorEditFiles;
  cap?: number;
}

const DEFAULT_CAP = 400;
/** A JSON batch stays under the relay's 8 MiB request; the margin covers the envelope. */
const BATCH_BYTES = 8 * 1024 * 1024 - 64 * 1024;
/** Text rows up to this size go in JSON batches; larger ones and every binary row go as a file. */
const SMALL_TEXT_BYTES = 1024 * 1024;
const WARN_RATIO = 0.9;
const encoder = new TextEncoder();

/** A changed file: its hash and size, and its text when it travels in a JSON batch. */
interface Changed { file: MirrorFile; hash: string; size: number; text?: string }
type Skipped = MirrorRunResult["skipped"];
interface Progress { uploaded: number; deleted: number; used: number; complete: boolean; full: boolean; leftOut: string[] }

function errorReason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Splits items into runs whose summed weight stays within the batch size. */
function batches<T>(items: T[], weight: (item: T) => number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = weight(item);
    if (current.length > 0 && bytes + itemBytes > BATCH_BYTES) { groups.push(current); current = []; bytes = 0; }
    current.push(item);
    bytes += itemBytes;
  }
  if (current.length > 0) { groups.push(current); }
  return groups;
}

const putWeight = (put: MirrorPut): number => encoder.encode(JSON.stringify(put)).byteLength + 1;
const pathWeight = (path: string): number => encoder.encode(JSON.stringify(path)).byteLength + 1;
const byteLength = (content: string | Uint8Array): number => typeof content === "string" ? encoder.encode(content).byteLength : content.byteLength;

/** Hashes each file; only the first `cap` changed ones are kept, which are all a run can send. */
async function diffFiles(cap: number, files: MirrorFile[], rows: Record<string, MirrorRow>, skipped: Skipped): Promise<{ changed: Changed[]; overCap: boolean; present: Set<string> }> {
  const changed: Changed[] = [];
  const present = new Set<string>();
  let overCap = false;
  for (const file of files) {
    present.add(file.path);
    let content: string | Uint8Array;
    let hash: string;
    try {
      content = await file.read();
      hash = await deriveTextSha256Hex(content);
    } catch (error) {
      skipped.push({ path: file.path, reason: errorReason(error, "The file could not be read.") });
      continue;
    }
    if (rows[file.path]?.hash === hash) { continue; }
    if (changed.length >= cap) { overCap = true; continue; }
    const size = byteLength(content);
    changed.push({ file, hash, size, ...(typeof content === "string" && size <= SMALL_TEXT_BYTES ? { text: content } : {}) });
  }
  return { changed, overCap, present };
}

/** Keeps the changed files that fit under the limit in order; the rest go to `leftOut`. */
function planBudget(changed: Changed[], rows: Record<string, MirrorRow>, status: MirrorStatus, leftOut: string[]): Changed[] {
  let projected = status.used;
  return changed.filter((entry) => {
    const next = projected + entry.size - (rows[entry.file.path]?.size ?? 0);
    if (next > status.limit) { leftOut.push(entry.file.path); return false; }
    projected = next;
    return true;
  });
}

/** Runs one relay request; a `full` refusal leaves its paths out and stops the run, other refusals throw. */
async function attempt(progress: Progress, paths: string[], request: () => Promise<void>): Promise<boolean> {
  try {
    await request();
    return true;
  } catch (error) {
    if (!(error instanceof MirrorRefusal) || error.code !== "full") { throw error; }
    progress.leftOut.push(...paths);
    progress.full = true;
    progress.complete = false;
    return false;
  }
}

class Sender {
  private first = true;
  constructor(private readonly deps: MirrorRunnerDeps, private readonly state: MirrorState, readonly progress: Progress, private readonly skipped: Skipped) {}

  private async renewed(): Promise<boolean> {
    if (this.first) { this.first = false; return true; }
    if (await this.deps.relay.lease("renew")) { return true; }
    this.progress.complete = false;
    return false;
  }

  private record(row: MirrorRow & { path: string }): void {
    this.progress.used += row.size - (this.state.rows[row.path]?.size ?? 0);
    this.state.rows[row.path] = { hash: row.hash, size: row.size, kind: row.kind };
  }

  /** Sends the small text rows in JSON batches; answers false when the run stopped. */
  async sendBatches(entries: Changed[]): Promise<boolean> {
    const puts = entries.map(({ file, hash, size, text }): MirrorPut => ({ path: file.path, kind: file.kind, hash, size, value: text! }));
    for (const group of batches(puts, putWeight)) {
      if (!await this.renewed()) { return false; }
      if (!await attempt(this.progress, group.map((put) => put.path), () => this.deps.relay.putRows(group, []))) { return false; }
      for (const put of group) { this.record(put); }
      await this.deps.state.write(this.state);
      this.progress.uploaded += group.length;
    }
    return true;
  }

  /** Sends each other row as its own file, read again so its hash matches the bytes sent; answers false when the run stopped. */
  async sendFiles(entries: Changed[]): Promise<boolean> {
    for (const { file } of entries) {
      if (!await this.renewed()) { return false; }
      const content = await file.read();
      const bytes = typeof content === "string" ? encoder.encode(content) : content;
      if (bytes.byteLength > MAX_MIRROR_FILE_BYTES) { this.skipped.push({ path: file.path, reason: "The file is over the 64 MiB limit." }); continue; }
      const hash = await deriveTextSha256Hex(bytes);
      try {
        if (!await attempt(this.progress, [file.path], () => this.deps.relay.putFile(file.path, file.kind, hash, bytes))) { return false; }
      } catch (error) {
        if (!(error instanceof MirrorRefusal) || error.code !== "tooLarge") { throw error; }
        this.skipped.push({ path: file.path, reason: "The relay refused the file as too large." });
        continue;
      }
      this.record({ path: file.path, hash, size: bytes.byteLength, kind: file.kind });
      await this.deps.state.write(this.state);
      this.progress.uploaded += 1;
    }
    return true;
  }

  /** Deletes the rows that disappeared in batches. */
  async deleteGone(gone: string[]): Promise<void> {
    for (const group of batches(gone, pathWeight)) {
      if (!await this.renewed()) { return; }
      await this.deps.relay.putRows([], group);
      for (const path of group) {
        this.progress.used -= this.state.rows[path]?.size ?? 0;
        delete this.state.rows[path];
      }
      await this.deps.state.write(this.state);
      this.progress.deleted += group.length;
    }
  }
}

function storageOf(status: MirrorStatus, progress: Progress): MirrorStorage {
  const used = Math.max(0, progress.used);
  return {
    store: status.store, used, limit: status.limit, warn: used >= WARN_RATIO * status.limit,
    full: progress.full || progress.leftOut.length > 0, leftOut: progress.leftOut,
  };
}

/** Applies the edits, diffs the selection against the table and sends what changed or disappeared. */
async function synchronise(deps: MirrorRunnerDeps, cap: number, skipped: Skipped): Promise<MirrorRunResult> {
  const status = await deps.relay.status();
  const edits = await applyMirrorEdits({ relay: deps.relay, files: deps.files, state: deps.state, generation: status.generation });
  const progress: Progress = { uploaded: 0, deleted: 0, used: status.used, complete: true, full: false, leftOut: [] };
  // INVARIANT: an edit that could not be applied holds the run, so the local file never overwrites the web version.
  if (edits.failed > 0) {
    return { status: "partial", uploaded: 0, deleted: 0, skipped, edits, storage: storageOf(status, progress) };
  }
  const state = stateForMirror(await deps.state.read(), status.generation);
  const selection = await deps.select({ includePdfs: status.includePdfs });
  skipped.push(...selection.skipped);
  const { changed, overCap, present } = await diffFiles(cap, selection.files, state.rows, skipped);
  const planned = planBudget(changed, state.rows, status, progress.leftOut);
  const gone = overCap ? [] : Object.keys(state.rows).filter((path) => !present.has(path));
  const sender = new Sender(deps, state, progress, skipped);
  try {
    const sent = await sender.sendBatches(planned.filter((entry) => entry.text !== undefined))
      && await sender.sendFiles(planned.filter((entry) => entry.text === undefined));
    // Files left out for the limit do not hold the deletes, which free space for them.
    if (sent && progress.complete) { await sender.deleteGone(gone); }
  } catch {
    progress.complete = false;
  }
  const complete = progress.complete && !overCap && progress.leftOut.length === 0;
  return { status: complete ? "synced" : "partial", uploaded: progress.uploaded, deleted: progress.deleted, skipped, edits, storage: storageOf(status, progress) };
}

export function createMirrorRunner(deps: MirrorRunnerDeps): { run(): Promise<MirrorRunResult> } {
  const cap = deps.cap ?? DEFAULT_CAP;
  return {
    async run() {
      const skipped: Skipped = [];
      let held: boolean;
      try {
        held = await deps.relay.lease("acquire");
      } catch {
        return { status: "skipped", uploaded: 0, deleted: 0, skipped };
      }
      if (!held) { return { status: "skipped", uploaded: 0, deleted: 0, skipped }; }
      try {
        return await synchronise(deps, cap, skipped);
      } finally {
        await deps.relay.lease("release").catch(() => undefined);
      }
    },
  };
}
