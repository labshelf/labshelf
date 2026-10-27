/**
 * The write path every metadata.yaml change goes through: the ports a mutation runs over, the read of a paper as its
 * folder holds it now, the record write under the library-format and sync ownership rules (tags, note and the reading
 * status belong to whoever set them, hasPdf is never stored), and each device's project write history.
 */
import type { PaperRecord } from "../../model/index.js";
import { formatError } from "../../errors/index.js";
import { parseJsonObject } from "../../json/index.js";
import { checkRelativePath, type PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import { METADATA_FILE, PDF_FILE } from "../layout.js";
import { createPaperRecord, isReadingStatus, parsePaperMetadata } from "../record.js";

/** Writes metadata.yaml and bib.bib for a paper; the core BibTeXService satisfies it. */
export interface MetadataWriter {
  writePaperArtifacts(folder: string, paper: PaperRecord, sourceFileName: string): Promise<void>;
}

export interface MutationContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  artifacts: MetadataWriter;
  logger: ILogger;
  /** The papers/ folder: folder operations refuse to rename, move or trash it. */
  papersRoot: string;
  /** ISO timestamp for text-layer verdicts; the wall clock when absent. */
  now?: () => string;
}

/** A paper as the app's index knows it: enough to find its folder. */
export interface Reference {
  id: string;
  path: string;
}

export interface BatchOutcome {
  done: string[];
  failed: Array<{ id: string; error: string }>;
}

export const MUTATIONS_MODULE = "library/mutations";

// Reads a paper as its folder holds it right now, since another app or a sync may have changed it since the last scan.

/** @returns the paper in `folder`, or undefined when its metadata.yaml is missing or not a mapping */
export async function readPaperOnFileSystem(ctx: MutationContext, folder: string): Promise<PaperRecord | undefined> {
  const meta = await readMetadata(ctx, folder);
  if (!meta) { return undefined; }
  const pdf = await ctx.fs.stat(ctx.paths.join(folder, PDF_FILE));
  return createPaperRecord(meta, { id: ctx.paths.basename(folder), path: folder, hasPdf: pdf?.isFile === true });
}

/** @returns the reading status metadata.yaml holds and when it changed, or undefined when it cannot be read or holds no status */
export async function readReadingStatusOnFileSystem(ctx: MutationContext, folder: string): Promise<Pick<PaperRecord, "status" | "statusChangedAt"> | undefined> {
  const meta = await readMetadata(ctx, folder);
  if (!meta || !isReadingStatus(meta["status"])) { return undefined; }
  const { status, statusChangedAt } = createPaperRecord(meta, { id: "", path: folder, hasPdf: false });
  return statusChangedAt === undefined ? { status } : { status, statusChangedAt };
}

async function readMetadata(ctx: MutationContext, folder: string): Promise<Record<string, unknown> | undefined> {
  const file = ctx.paths.join(folder, METADATA_FILE);
  if (!(await ctx.fs.exists(file))) { return undefined; }
  return parsePaperMetadata(await ctx.fs.readText(file));
}

export interface WriteRecordOptions {
  /** True only for an explicit status change; any other rewrite keeps the status metadata.yaml holds. */
  ownsStatus: boolean;
  /** Set to replace the file's tags; left out, the file's own tags stay. */
  tags?: string[];
  /** Set to replace the file's note; left out, the file's own note stays. */
  note?: string;
}

/**
 * Rewrites a paper's metadata.yaml and bib.bib from a record, typically one from an app's index.
 * @returns the record as written, with the status that went to disk
 */
export async function writePaperRecord(
  ctx: MutationContext,
  record: PaperRecord,
  options: WriteRecordOptions,
): Promise<PaperRecord> {
  // The status and its timestamp go together: when the file's status wins, so does the file's timestamp.
  const { statusChangedAt: _changedAt, ...unstamped } = record;
  const { tags: _tags, note: _note, hasPdf: _hasPdf, ...rest } = unstamped;
  const status = options.ownsStatus ? statusFields(record) : await keptStatus(ctx, record);
  const owned: Pick<PaperRecord, "tags" | "note"> = {};
  if (options.tags !== undefined) { owned.tags = options.tags; }
  if (options.note !== undefined) { owned.note = options.note; }
  await ctx.artifacts.writePaperArtifacts(record.path, { ...rest, ...status, ...owned }, ctx.paths.join(record.path, PDF_FILE));
  return { ...unstamped, ...status, ...owned };
}

type StatusFields = Pick<PaperRecord, "status" | "statusChangedAt">;

function statusFields(record: PaperRecord): StatusFields {
  return record.statusChangedAt === undefined ? { status: record.status } : { status: record.status, statusChangedAt: record.statusChangedAt };
}

// The terminal app or a sync may have changed the status after the index was built; the file's copy wins.
async function keptStatus(ctx: MutationContext, record: PaperRecord): Promise<StatusFields> {
  let reason: string;
  try {
    const onDisk = await readReadingStatusOnFileSystem(ctx, record.path);
    if (onDisk) { return onDisk; }
    reason = "metadata.yaml holds no valid status";
  } catch (error) {
    reason = formatError(error);
  }
  await ctx.logger.log("WARN", MUTATIONS_MODULE, "Status on disk unreadable, keeping the indexed status", {
    id: record.id, status: record.status, reason,
  });
  return statusFields(record);
}

// Per-device file version records shared through a project folder; each device writes only its own bounded history.

export interface DeviceIdentity { id(): Promise<string> }
export interface WriteRecord {
  hash: string;
  parent: string | null;
  by: 'mirror' | 'app';
  at: number;
}
export interface WriteRecordEntry extends WriteRecord { path: string }
export type WriteRecords = Map<string, WriteRecord[]>;
export type WriteRecordFileSystem = Pick<LibraryFileSystem, 'ensureDir' | 'writeText' | 'readText' | 'listDir'>;
export interface WriteRecordStore {
  append(entry: WriteRecordEntry): Promise<void>;
  read(): Promise<WriteRecords>;
}
export const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const HASH = /^[0-9a-f]{64}$/;
function validRecord(value: unknown): value is WriteRecord {
  if (!value || typeof value !== 'object') { return false; }
  const { hash, parent, by, at } = value as Record<string, unknown>;
  return typeof hash === 'string' && HASH.test(hash)
    && (parent === null || typeof parent === 'string' && HASH.test(parent))
    && (by === 'mirror' || by === 'app') && typeof at === 'number' && Number.isFinite(at) && at >= 0;
}

function parseRecords(text: string): WriteRecords | undefined {
  const root = parseJsonObject(text);
  if (!root) { return undefined; }
  const { version, files } = root;
  if (version !== 1 || !files || typeof files !== 'object' || Array.isArray(files)) { return undefined; }
  const records: WriteRecords = new Map();
  for (const [path, entries] of Object.entries(files)) {
    if (checkRelativePath(path) || !Array.isArray(entries) || !entries.every(validRecord)) { return undefined; }
    records.set(path, entries.slice(-50));
  }
  return records;
}

const WRITE_RECORDS_MODULE = 'library.writeRecords';
const pending = new WeakMap<WriteRecordFileSystem, Map<string, Promise<void>>>();
const directory = (folder: string) => `${folder.replace(/\/+$/, '')}/.labshelf/writes`;

async function readDevice(fs: WriteRecordFileSystem, file: string, logger: ILogger): Promise<WriteRecords> {
  const records = parseRecords(await fs.readText(file));
  if (records) { return records; }
  await logger.log('WARN', WRITE_RECORDS_MODULE, 'Treated an invalid write record file as empty', { file });
  return new Map();
}

async function append(fs: WriteRecordFileSystem, folder: string, deviceId: string, entry: WriteRecordEntry, logger: ILogger): Promise<void> {
  const dir = directory(folder);
  const file = `${dir}/${deviceId}.json`;
  const records = (await fs.listDir(dir)).includes(`${deviceId}.json`) ? await readDevice(fs, file, logger) : new Map();
  const { path, hash, parent, by, at } = entry;
  records.set(path, [...records.get(path) ?? [], { hash, parent, by, at }].slice(-50));
  await fs.ensureDir(dir);
  // INVARIANT: the injected file port writes text atomically.
  await fs.writeText(file, JSON.stringify({ version: 1, files: Object.fromEntries(records) }) + '\n');
}

export async function addWriteRecord(fs: WriteRecordFileSystem, folder: string, deviceId: string, entry: WriteRecordEntry, logger: ILogger): Promise<void> {
  if (!DEVICE_ID.test(deviceId)) { throw new Error(`Invalid write record device id: ${deviceId}`); }
  if (checkRelativePath(entry.path) || !validRecord(entry)) { throw new Error(`Invalid write record for ${entry.path}`); }
  let queue = pending.get(fs);
  if (!queue) { queue = new Map(); pending.set(fs, queue); }
  const key = `${directory(folder)}/${deviceId}`;
  const previous = queue.get(key) ?? Promise.resolve();
  const operation = previous.then(() => append(fs, folder, deviceId, entry, logger));
  const settled = operation.then(() => {}, () => {});
  queue.set(key, settled);
  try { await operation; }
  catch (error) { await logger.error(WRITE_RECORDS_MODULE, error, { folder, deviceId, path: entry.path }); throw error; }
  finally { if (queue.get(key) === settled) { queue.delete(key); } }
}

export async function readWriteRecords(fs: WriteRecordFileSystem, folder: string, logger: ILogger): Promise<WriteRecords> {
  const dir = directory(folder);
  const records: WriteRecords = new Map();
  try {
    for (const name of await fs.listDir(dir)) {
      if (!name.endsWith('.json') || !DEVICE_ID.test(name.slice(0, -5))) { continue; }
      for (const [path, entries] of await readDevice(fs, `${dir}/${name}`, logger)) {
        records.set(path, [...records.get(path) ?? [], ...entries]);
      }
    }
    return records;
  } catch (error) { await logger.error(WRITE_RECORDS_MODULE, error, { folder }); throw error; }
}


export function recordFor(records: WriteRecords, path: string, hash: string) {
  const entries = records.get(path)?.filter(entry => entry.hash === hash);
  return entries?.find(entry => entry.by === 'mirror') ?? entries?.at(-1);
}

export function createWriteRecordStore(fs: WriteRecordFileSystem, folder: string, identity: DeviceIdentity, logger: ILogger): WriteRecordStore {
  return {
    append: async entry => addWriteRecord(fs, folder, await identity.id(), entry, logger),
    read: () => readWriteRecords(fs, folder, logger),
  };
}
