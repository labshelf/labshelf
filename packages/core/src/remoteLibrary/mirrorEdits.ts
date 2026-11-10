/** Brings the edits made on /open/ into the library: for each edit the Mirror lists, a local file still at the edit's base
 * takes the web version (or is deleted), a local file already at the web version is left alone, and any other local file
 * is kept while the web version is written beside it as an app conflict copy. After each settled edit the device table
 * records the row as the Mirror holds it and the edit is acked, so the next sync re-uploads a conflicted local file. */
import { deriveTextSha256Hex } from "../hash/index.js";
import { conflictCopyPath } from "../library/conflicts/conflictCopy.js";
import type { MirrorEdit, MirrorRelay } from "./mirrorRelay.js";
import { mirrorKindOfPath, stateForMirror, type MirrorStateStore } from "./mirrorState.js";

/** The host's library files by library-relative path; `readBytes` answers undefined for a missing file, `writeBytes` creates parent folders. */
export interface MirrorEditFiles {
  readBytes(path: string): Promise<Uint8Array | undefined>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface MirrorEditsResult { applied: number; conflicts: string[]; failed: number }

export interface MirrorEditsDeps {
  relay: Pick<MirrorRelay, "edits" | "readFile" | "ackEdits" | "lease" | "status">;
  files: MirrorEditFiles;
  state: MirrorStateStore;
  /** Given by a sync run, which already holds the writer lease. Without it (the hosts' 60 s timer) the pull takes the lease
   * and reads the generation from the status, both only when edits wait. */
  generation?: string;
}

const nothing = (): MirrorEditsResult => ({ applied: 0, conflicts: [], failed: 0 });
const EDITABLE = /^(home\.json|(spaces|papers|projects)\/.+)$/;

/** A library-relative path inside the areas /open/ may edit, with no empty, `.` or `..` segment. */
function isEditablePath(path: string): boolean {
  return EDITABLE.test(path) && !path.includes("\\") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The web version of an edit, or undefined when the Mirror's row moved on since the list was read. */
async function webVersion(deps: MirrorEditsDeps, edit: MirrorEdit): Promise<Uint8Array | undefined> {
  const bytes = await deps.relay.readFile(edit.path);
  return (await deriveTextSha256Hex(bytes)) === edit.hash ? bytes : undefined;
}

/** Settles one edit; answers the conflict copy's path when one was written, "stale" when the row moved on. */
async function settle(deps: MirrorEditsDeps, generation: string, edit: MirrorEdit): Promise<{ copy?: string } | "stale"> {
  const local = await deps.files.readBytes(edit.path);
  const localHash = local === undefined ? "" : await deriveTextSha256Hex(local);
  let size = 0;
  let copy: string | undefined;
  if (!edit.deleted && localHash !== edit.hash) {
    const bytes = await webVersion(deps, edit);
    if (!bytes) { return "stale"; }
    size = bytes.byteLength;
    if (localHash === edit.base) {
      await deps.files.writeBytes(edit.path, bytes);
    } else {
      copy = conflictCopyPath(edit.path);
      await deps.files.writeBytes(copy, bytes);
    }
  } else if (edit.deleted && local !== undefined && localHash === edit.base) {
    await deps.files.remove(edit.path);
  } else if (!edit.deleted) {
    size = local!.byteLength;
  }
  const state = stateForMirror(await deps.state.read(), generation);
  if (edit.deleted) {
    delete state.rows[edit.path];
  } else {
    state.rows[edit.path] = { hash: edit.hash, size, kind: state.rows[edit.path]?.kind ?? mirrorKindOfPath(edit.path) };
  }
  await deps.state.write(state);
  await deps.relay.ackEdits([{ path: edit.path, hash: edit.hash }]);
  return copy === undefined ? {} : { copy };
}

async function applyAll(deps: MirrorEditsDeps, generation: string, edits: MirrorEdit[]): Promise<MirrorEditsResult> {
  const result = nothing();
  for (const edit of edits) {
    try {
      if (!isEditablePath(edit.path)) {
        await deps.relay.ackEdits([{ path: edit.path, hash: edit.hash }]);
        result.failed += 1;
        continue;
      }
      const settled = await settle(deps, generation, edit);
      if (settled === "stale") { continue; }
      if (settled.copy !== undefined) { result.conflicts.push(settled.copy); } else { result.applied += 1; }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/** Reads the Mirror's edit list and settles each edit; an empty list costs one request. A failed edit stays unacked for the next pull. */
export async function applyMirrorEdits(deps: MirrorEditsDeps): Promise<MirrorEditsResult> {
  const edits = await deps.relay.edits();
  if (edits.length === 0) { return nothing(); }
  if (deps.generation !== undefined) { return applyAll(deps, deps.generation, edits); }
  if (!await deps.relay.lease("acquire")) { return nothing(); }
  try {
    return await applyAll(deps, (await deps.relay.status()).generation, edits);
  } finally {
    await deps.relay.lease("release").catch(() => undefined);
  }
}
