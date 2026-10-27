// Reads and writes one line of a project's history log, which is validated on read because the file outlives app versions.
import { isProjectPath } from "../../path/index.js";
import { parseJsonObject } from "../project/index.js";

/** "edit" is a save, "restore" a jump back to an earlier entry, "version" a marked version. */
export type HistoryKind = "edit" | "restore" | "version";

export interface HistoryEntry {
  id: string;
  /** ISO 8601 UTC timestamp. */
  at: string;
  kind: HistoryKind;
  /** The version name, or the timestamp of the entry a restore went back to. */
  label?: string;
  /** Project-relative path with "/" separators → SHA-256 of its content. */
  files: Record<string, string>;
}

const KINDS: readonly string[] = ["edit", "restore", "version"];
const HASH = /^[0-9a-f]{64}$/;

function parseFiles(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { return undefined; }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.every(([path, hash]) => isProjectPath(path) && typeof hash === "string" && HASH.test(hash))) { return undefined; }
  return Object.fromEntries(entries) as Record<string, string>;
}

/** @returns undefined when the line is not a valid entry */
export function parseHistoryLine(line: string): HistoryEntry | undefined {
  const raw = parseJsonObject(line);
  if (!raw) { return undefined; }
  const { id, at, kind, label } = raw;
  const files = parseFiles(raw["files"]);
  if (typeof id !== "string" || id === "" || typeof at !== "string" || Number.isNaN(Date.parse(at))) { return undefined; }
  if (typeof kind !== "string" || !KINDS.includes(kind) || !files) { return undefined; }
  if (label !== undefined && typeof label !== "string") { return undefined; }
  return { id, at, kind: kind as HistoryKind, ...(label !== undefined && { label }), files };
}

export function serializeHistoryLine(entry: HistoryEntry): string {
  return `${JSON.stringify(entry)}\n`;
}
