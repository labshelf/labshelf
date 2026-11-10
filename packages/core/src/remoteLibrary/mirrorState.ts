/** The device-local mirror hash table: what the Mirror holds per library-relative path as this device last saw it, its
 * strict parse (anything unexpected answers undefined, so the next run re-pushes everything) and its reset when the
 * Mirror's generation changes (a cleared Mirror or a store move; a relay rotation keeps the generation). */
import { isRecord } from "../guards/index.js";
import { parseJsonObject } from "../json/index.js";

export type MirrorKind = "papers" | "notes" | "source" | "deck" | "space" | "home" | "output" | "asset" | "pdf";
export interface MirrorRow { hash: string; size: number; kind: MirrorKind }
export interface MirrorState { version: 2; generation: string; rows: Record<string, MirrorRow> }
export interface MirrorStateStore { read(): Promise<MirrorState | undefined>; write(state: MirrorState): Promise<void>; clear(): Promise<void> }

const KINDS: ReadonlySet<string> = new Set<MirrorKind>(["papers", "notes", "source", "deck", "space", "home", "output", "asset", "pdf"]);

/** True for one of the kinds a Mirror row may have. */
export const isMirrorKind = (value: unknown): value is MirrorKind => typeof value === "string" && KINDS.has(value);

// CONTRACT: documents/contracts/remote-library.md — the kind the Mirror gives a row first written by an edit on /open/.
/** The kind of a row an edit creates, from its path: home.json, spaces/, papers/, else source. */
export function mirrorKindOfPath(path: string): MirrorKind {
  if (path === "home.json") { return "home"; }
  if (path.startsWith("spaces/")) { return "space"; }
  return path.startsWith("papers/") ? "notes" : "source";
}

function parseRow(value: unknown): MirrorRow | undefined {
  if (!isRecord(value)) { return undefined; }
  const { hash, size, kind } = value;
  if (typeof hash !== "string" || typeof size !== "number" || !Number.isFinite(size) || size < 0) { return undefined; }
  if (!isMirrorKind(kind)) { return undefined; }
  return { hash, size, kind };
}

export function parseMirrorState(text: string): MirrorState | undefined {
  const value = parseJsonObject(text);
  if (!value || value["version"] !== 2 || typeof value["generation"] !== "string" || !isRecord(value["rows"])) { return undefined; }
  const rows: Record<string, MirrorRow> = {};
  for (const [file, raw] of Object.entries(value["rows"])) {
    const row = parseRow(raw);
    if (!row) { return undefined; }
    rows[file] = row;
  }
  return { version: 2, generation: value["generation"], rows };
}

export function serializeMirrorState(state: MirrorState): string {
  return `${JSON.stringify({ version: state.version, generation: state.generation, rows: state.rows }, null, 2)}\n`;
}

/** The same state for the same generation; an empty table for that generation otherwise (cleared Mirror, store move, no state yet). */
export function stateForMirror(state: MirrorState | undefined, generation: string): MirrorState {
  if (state && state.generation === generation) { return state; }
  return { version: 2, generation, rows: {} };
}
