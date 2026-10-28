/** Records, lists, restores and shows the snapshots of a project's local history: the log line format, the storage port, the changes of an entry, the line diff and the rows a history page shows. */
import { isProjectPath } from "../../path/index.js";
import { parseJsonObject } from "../../json/index.js";
import { randomHex } from "../../encoding/index.js";
import { deriveSha256Hex } from "../../hash/index.js";
import type { ILogger } from "../../ports/index.js";
import { listProjectFiles, type ProjectReadContext } from "../project/index.js";
import type { HistoryRow } from "./protocol.js";

// --- Log entries ---

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

// --- Entry changes ---

export type FileChangeKind = "added" | "modified" | "deleted";

export interface FileChange {
  path: string;
  change: FileChangeKind;
}

/** Sorted by path; the first entry of a history has every file as added. */
export function deriveEntryChanges(before: HistoryEntry | undefined, entry: HistoryEntry): FileChange[] {
  const old = before?.files ?? {};
  const changes: FileChange[] = [];
  for (const [path, hash] of Object.entries(entry.files)) {
    if (!(path in old)) { changes.push({ path, change: "added" }); } else if (old[path] !== hash) { changes.push({ path, change: "modified" }); }
  }
  for (const path of Object.keys(old)) { if (!(path in entry.files)) { changes.push({ path, change: "deleted" }); } }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// --- Storage ---

export interface HistoryStorage {
  /** @returns the whole log, or "" when nothing was recorded yet */
  readLog(): Promise<string>;
  /** Appends one serialized line, creating the log when missing. */
  appendLog(line: string): Promise<void>;
  hasObject(hash: string): Promise<boolean>;
  readObject(hash: string): Promise<Uint8Array>;
  // INVARIANT: an object is written atomically, so a crash never leaves a truncated object under its hash.
  writeObject(hash: string, bytes: Uint8Array): Promise<void>;
}

/** A project folder, how to read and restore its files, and where its history is kept. */
export interface HistoryProject {
  project: Pick<ProjectReadContext, "fs" | "paths">;
  folder: string;
  storage: HistoryStorage;
}

// --- Recording and restoring ---

/** Larger files, such as datasets or videos, would make every snapshot slow and the store large. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUILT_SIBLINGS = [".tex", ".typ"];

// A PDF next to a source of the same name is the build's copy of its output, which every save rewrites.
function isBuiltPdf(file: string, all: ReadonlySet<string>): boolean {
  if (!file.toLowerCase().endsWith(".pdf")) { return false; }
  const stem = file.slice(0, -4);
  return BUILT_SIBLINGS.some((ext) => all.has(stem + ext));
}

/** @returns project-relative paths with "/" separators → SHA-256 */
async function snapshotFiles({ project, folder, storage }: HistoryProject): Promise<Record<string, string>> {
  const relatives = await listProjectFiles(project, folder);
  const all = new Set(relatives);
  const map: Record<string, string> = {};
  for (const relative of relatives) {
    if (isBuiltPdf(relative, all)) { continue; }
    const full = project.paths.join(folder, ...relative.split("/"));
    const stat = await project.fs.stat(full);
    if (!stat || stat.size > MAX_FILE_BYTES) { continue; }
    const content = await project.fs.readFile(full);
    const hash = await deriveSha256Hex(content);
    if (!(await storage.hasObject(hash))) { await storage.writeObject(hash, content); }
    map[relative] = hash;
  }
  return map;
}

const MODULE = "writing/history";

const queues = new Map<string, Promise<unknown>>();

// Two saves in a row must not both append against the same last entry, so operations on one history run in order.
function serialized<T>(folder: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(folder) ?? Promise.resolve()).then(run, run);
  queues.set(folder, next.catch(() => undefined));
  return next;
}

/** @returns the entries, oldest first; lines that cannot be read are logged and skipped */
export async function readHistory(storage: HistoryStorage, logger: ILogger): Promise<HistoryEntry[]> {
  const lines = (await storage.readLog()).split("\n").filter((line) => line.trim() !== "");
  const entries = lines.map(parseHistoryLine).filter((entry) => entry !== undefined);
  if (entries.length < lines.length) {
    await logger.log("WARN", MODULE, "Skipped unreadable history lines", { skipped: lines.length - entries.length });
  }
  return entries;
}

const sameFiles = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([file, hash]) => b[file] === hash);

function entryId(at: string): string {
  return `${Date.parse(at)}-${randomHex(3)}`;
}

async function append(storage: HistoryStorage, kind: HistoryKind, files: Record<string, string>, label?: string): Promise<HistoryEntry> {
  const at = new Date().toISOString();
  const entry: HistoryEntry = { id: entryId(at), at, kind, ...(label !== undefined && { label }), files };
  await storage.appendLog(serializeHistoryLine(entry));
  return entry;
}

async function recordNow(target: HistoryProject, kind: HistoryKind, label: string | undefined, logger: ILogger): Promise<HistoryEntry | undefined> {
  const files = await snapshotFiles(target);
  const last = (await readHistory(target.storage, logger)).at(-1);
  // An unchanged save adds nothing; a marked version is kept as a milestone even on unchanged files.
  if (kind === "edit" && last && sameFiles(last.files, files)) { return undefined; }
  return append(target.storage, kind, files, label);
}

/** @returns the new entry, or undefined when an edit changed no file since the last entry */
export function writeSnapshot(target: HistoryProject, kind: HistoryKind, logger: ILogger, label?: string): Promise<HistoryEntry | undefined> {
  return serialized(target.folder, () => recordNow(target, kind, label, logger));
}

async function restoreNow(target: HistoryProject, id: string, logger: ILogger): Promise<HistoryEntry> {
  const { project, folder, storage } = target;
  const wanted = (await readHistory(storage, logger)).find((entry) => entry.id === id);
  if (!wanted) { throw new Error(`The history of ${folder} has no entry ${id}`); }
  // The state on disk is recorded first, so the restore itself can be undone from the history.
  await recordNow(target, "edit", undefined, logger);
  const current = await snapshotFiles(target);
  for (const [file, hash] of Object.entries(wanted.files)) {
    if (current[file] === hash) { continue; }
    const full = project.paths.join(folder, ...file.split("/"));
    await project.fs.ensureDir(project.paths.dirname(full));
    await project.fs.writeFile(full, await storage.readObject(hash));
  }
  const removed = Object.keys(current).filter((file) => !(file in wanted.files));
  await Promise.all(removed.map((file) => project.fs.deleteFile(project.paths.join(folder, ...file.split("/")))));
  await logger.log("INFO", MODULE, "Restored a project to a history entry", { folder, id, removed: removed.length });
  return append(storage, "restore", wanted.files, wanted.at);
}

/**
 * Writes the files of entry `id` back into the project and deletes the files it did not have.
 * @throws when the entry does not exist or a file cannot be written
 */
export function applySnapshot(target: HistoryProject, id: string, logger: ILogger): Promise<HistoryEntry> {
  return serialized(target.folder, () => restoreNow(target, id, logger));
}

// --- Line diff ---

export type DiffLineKind = "same" | "added" | "removed" | "gap";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Past this many cells of the LCS table the changed middle shows as fully removed then added. */
const MAX_CELLS = 4_000_000;
const CONTEXT = 3;

function middleDiff(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  }
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: "same", text: a[i++]! }); j++; }
    // On a tie the removed line goes first, so a replaced line reads as old then new.
    else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) { out.push({ kind: "removed", text: a[i++]! }); }
    else { out.push({ kind: "added", text: b[j++]! }); }
  }
  return out;
}

// Keeps CONTEXT unchanged lines around each change and replaces the rest of a run with one gap line holding its count.
function foldUnchanged(lines: DiffLine[]): DiffLine[] {
  const keep = lines.map((line) => line.kind !== "same");
  lines.forEach((line, index) => {
    if (line.kind === "same") { return; }
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(lines.length - 1, index + CONTEXT); k++) { keep[k] = true; }
  });
  const out: DiffLine[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden > 0) { out.push({ kind: "gap", text: String(hidden) }); hidden = 0; }
      out.push(line);
    } else { hidden++; }
  });
  if (hidden > 0) { out.push({ kind: "gap", text: String(hidden) }); }
  return out;
}

export function compareLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split(/\r?\n/);
  const b = after === "" ? [] : after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) { start++; }
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) { end++; }
  const same = (text: string): DiffLine => ({ kind: "same", text });
  return foldUnchanged([
    ...a.slice(0, start).map(same),
    ...middleDiff(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map(same),
  ]);
}

// --- History page views ---

/** A NUL byte in the first 8 KiB marks a file as binary, as git does. */
const isBinary = (content: Uint8Array): boolean => content.subarray(0, 8192).includes(0);

/** @returns the rows, newest first */
export async function readHistoryRows(storage: HistoryStorage, logger: ILogger): Promise<HistoryRow[]> {
  const entries = await readHistory(storage, logger);
  return entries.map((entry, index) => ({
    id: entry.id, at: entry.at, kind: entry.kind, ...(entry.label !== undefined && { label: entry.label }), changes: deriveEntryChanges(entries[index - 1], entry),
  })).reverse();
}

/** @returns the diff against the entry before, [] for an unknown entry, null when either side is binary */
export async function readHistoryDiff(storage: HistoryStorage, id: string, file: string, logger: ILogger): Promise<DiffLine[] | null> {
  const entries = await readHistory(storage, logger);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) { return []; }
  const read = async (hash: string | undefined): Promise<Uint8Array> => (hash ? storage.readObject(hash) : new Uint8Array());
  const [before, after] = await Promise.all([read(entries[index - 1]?.files[file]), read(entries[index]!.files[file])]);
  if (isBinary(before) || isBinary(after)) { return null; }
  const decoder = new TextDecoder();
  return compareLines(decoder.decode(before), decoder.decode(after));
}
