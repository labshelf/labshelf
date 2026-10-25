// Records, lists and restores the snapshots of a project's local history, one operation at a time per project folder.
import type { ILogger } from "../../ports/index.js";
import { parseHistoryLine, serializeHistoryLine, type HistoryEntry, type HistoryKind } from "./historyEntry.js";
import type { HistoryStorage, HistoryTarget } from "./historyStorage.js";
import { listProjectFiles } from "../project/folder/index.js";

/** Larger files, such as datasets or videos, would make every snapshot slow and the store large. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUILT_SIBLINGS = [".tex", ".typ"];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A PDF next to a source of the same name is the build's copy of its output, which every save rewrites.
function isBuiltPdf(file: string, all: ReadonlySet<string>): boolean {
  if (!file.toLowerCase().endsWith(".pdf")) { return false; }
  const stem = file.slice(0, -4);
  return BUILT_SIBLINGS.some((ext) => all.has(stem + ext));
}

/** @returns project-relative paths with "/" separators → SHA-256 */
async function snapshotFiles({ project, folder, storage }: HistoryTarget): Promise<Record<string, string>> {
  const relatives = await listProjectFiles(project, folder);
  const all = new Set(relatives);
  const map: Record<string, string> = {};
  for (const relative of relatives) {
    if (isBuiltPdf(relative, all)) { continue; }
    const full = project.paths.join(folder, ...relative.split("/"));
    const stat = await project.fs.stat(full);
    if (!stat || stat.size > MAX_FILE_BYTES) { continue; }
    const content = await project.fs.readFile(full);
    const hash = await sha256Hex(content);
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
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${Date.parse(at)}-${suffix}`;
}

async function append(storage: HistoryStorage, kind: HistoryKind, files: Record<string, string>, label?: string): Promise<HistoryEntry> {
  const at = new Date().toISOString();
  const entry: HistoryEntry = { id: entryId(at), at, kind, ...(label !== undefined && { label }), files };
  await storage.appendLog(serializeHistoryLine(entry));
  return entry;
}

async function recordNow(target: HistoryTarget, kind: HistoryKind, label: string | undefined, logger: ILogger): Promise<HistoryEntry | undefined> {
  const files = await snapshotFiles(target);
  const last = (await readHistory(target.storage, logger)).at(-1);
  // An unchanged save adds nothing; a marked version is kept as a milestone even on unchanged files.
  if (kind === "edit" && last && sameFiles(last.files, files)) { return undefined; }
  return append(target.storage, kind, files, label);
}

/** @returns the new entry, or undefined when an edit changed no file since the last entry */
export function recordSnapshot(target: HistoryTarget, kind: HistoryKind, logger: ILogger, label?: string): Promise<HistoryEntry | undefined> {
  return serialized(target.folder, () => recordNow(target, kind, label, logger));
}

async function restoreNow(target: HistoryTarget, id: string, logger: ILogger): Promise<HistoryEntry> {
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
export function restoreSnapshot(target: HistoryTarget, id: string, logger: ILogger): Promise<HistoryEntry> {
  return serialized(target.folder, () => restoreNow(target, id, logger));
}
