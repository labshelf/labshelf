// Records, lists and restores the snapshots of a project's local history, one operation at a time per history folder.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { parseHistoryLine, serializeHistoryLine, type HistoryEntry, type HistoryKind } from "../historyEntry.js";
import { HISTORY_LOG } from "../historyLayout.js";
import { objectPath, snapshotFiles } from "./snapshotFiles.js";

const MODULE = "writing/history";

/** A project folder and the folder that keeps its history. */
export interface HistoryTarget {
  folder: string;
  historyDir: string;
}

const queues = new Map<string, Promise<unknown>>();

// Two saves in a row must not both append against the same last entry, so operations on one history run in order.
function serialized<T>(historyDir: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(historyDir) ?? Promise.resolve()).then(run, run);
  queues.set(historyDir, next.catch(() => undefined));
  return next;
}

/** @returns the entries, oldest first; lines that cannot be read are logged and skipped */
export async function readHistory(historyDir: string, logger: ILogger): Promise<HistoryEntry[]> {
  const text = await fs.readFile(path.join(historyDir, HISTORY_LOG), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return ""; }
    throw error;
  });
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const entries = lines.map(parseHistoryLine).filter((entry) => entry !== undefined);
  if (entries.length < lines.length) {
    await logger.log("WARN", MODULE, "Skipped unreadable history lines", { historyDir, skipped: lines.length - entries.length });
  }
  return entries;
}

export function readHistoryObject(historyDir: string, hash: string): Promise<Buffer> {
  return fs.readFile(objectPath(historyDir, hash));
}

const sameFiles = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([file, hash]) => b[file] === hash);

async function append(historyDir: string, kind: HistoryKind, files: Record<string, string>, label?: string): Promise<HistoryEntry> {
  const at = new Date().toISOString();
  const entry: HistoryEntry = { id: `${Date.parse(at)}-${randomBytes(3).toString("hex")}`, at, kind, ...(label !== undefined && { label }), files };
  await fs.mkdir(historyDir, { recursive: true });
  await fs.appendFile(path.join(historyDir, HISTORY_LOG), serializeHistoryLine(entry));
  return entry;
}

async function recordNow(target: HistoryTarget, kind: HistoryKind, label: string | undefined, logger: ILogger): Promise<HistoryEntry | undefined> {
  const files = await snapshotFiles(target.folder, target.historyDir);
  const last = (await readHistory(target.historyDir, logger)).at(-1);
  // An unchanged save adds nothing; a marked version is kept as a milestone even on unchanged files.
  if (kind === "edit" && last && sameFiles(last.files, files)) { return undefined; }
  return append(target.historyDir, kind, files, label);
}

/** @returns the new entry, or undefined when an edit changed no file since the last entry */
export function recordSnapshot(target: HistoryTarget, kind: HistoryKind, logger: ILogger, label?: string): Promise<HistoryEntry | undefined> {
  return serialized(target.historyDir, () => recordNow(target, kind, label, logger));
}

async function restoreNow(target: HistoryTarget, id: string, logger: ILogger): Promise<HistoryEntry> {
  const wanted = (await readHistory(target.historyDir, logger)).find((entry) => entry.id === id);
  if (!wanted) { throw new Error(`The history of ${target.folder} has no entry ${id}`); }
  // The state on disk is recorded first, so the restore itself can be undone from the history.
  await recordNow(target, "edit", undefined, logger);
  const current = await snapshotFiles(target.folder, target.historyDir);
  for (const [file, hash] of Object.entries(wanted.files)) {
    if (current[file] === hash) { continue; }
    const full = path.join(target.folder, ...file.split("/"));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, await readHistoryObject(target.historyDir, hash));
  }
  const removed = Object.keys(current).filter((file) => !(file in wanted.files));
  await Promise.all(removed.map((file) => fs.rm(path.join(target.folder, ...file.split("/")), { force: true })));
  await logger.log("INFO", MODULE, "Restored a project to a history entry", { folder: target.folder, id, removed: removed.length });
  return append(target.historyDir, "restore", wanted.files, wanted.at);
}

/**
 * Writes the files of entry `id` back into the project and deletes the files it did not have.
 * @throws when the entry does not exist or a file cannot be written
 */
export function restoreSnapshot(target: HistoryTarget, id: string, logger: ILogger): Promise<HistoryEntry> {
  return serialized(target.historyDir, () => restoreNow(target, id, logger));
}
