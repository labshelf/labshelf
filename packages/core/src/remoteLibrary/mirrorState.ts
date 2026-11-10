/** The device-local mirror hash table: what this device last pushed to the relay per library-relative path, its strict
 * parse (anything unexpected answers undefined, so the next run re-pushes everything) and its reset when the relay URL
 * changes. */
import { isRecord } from "../guards/index.js";
import { parseJsonObject } from "../json/index.js";

export interface MirrorRow { hash: string; size: number; kind: "papers" | "notes" | "source" | "deck" | "space" | "home" | "output" }
export interface MirrorState { version: 1; relayUrl: string; rows: Record<string, MirrorRow> }
export interface MirrorStateStore { read(): Promise<MirrorState | undefined>; write(state: MirrorState): Promise<void>; clear(): Promise<void> }

const KINDS: ReadonlySet<string> = new Set<MirrorRow["kind"]>(["papers", "notes", "source", "deck", "space", "home", "output"]);

function parseRow(value: unknown): MirrorRow | undefined {
  if (!isRecord(value)) { return undefined; }
  const { hash, size, kind } = value;
  if (typeof hash !== "string" || typeof size !== "number" || !Number.isFinite(size) || size < 0) { return undefined; }
  if (typeof kind !== "string" || !KINDS.has(kind)) { return undefined; }
  return { hash, size, kind: kind as MirrorRow["kind"] };
}

export function parseMirrorState(text: string): MirrorState | undefined {
  const value = parseJsonObject(text);
  if (!value || value["version"] !== 1 || typeof value["relayUrl"] !== "string" || !isRecord(value["rows"])) { return undefined; }
  const rows: Record<string, MirrorRow> = {};
  for (const [file, raw] of Object.entries(value["rows"])) {
    const row = parseRow(raw);
    if (!row) { return undefined; }
    rows[file] = row;
  }
  return { version: 1, relayUrl: value["relayUrl"], rows };
}

export function serializeMirrorState(state: MirrorState): string {
  return `${JSON.stringify({ version: state.version, relayUrl: state.relayUrl, rows: state.rows }, null, 2)}\n`;
}

/** The same state for the same relay URL; an empty table for that URL otherwise (rotation, reconnect, no state yet). */
export function stateForRelay(state: MirrorState | undefined, relayUrl: string): MirrorState {
  if (state && state.relayUrl === relayUrl) { return state; }
  return { version: 1, relayUrl, rows: {} };
}
