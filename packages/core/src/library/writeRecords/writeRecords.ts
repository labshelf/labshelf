// Persists each device's bounded write history without modifying its peers' files.
import type { ILogger } from '../../ports/index.js';
import { checkRelativePath } from "../../path/index.js";
import {
  DEVICE_ID,
  type WriteRecordEntry,
  type WriteRecordFileSystem,
  type WriteRecords,
  type WriteRecord,
} from "./writeRecord.js";

const HASH = /^[0-9a-f]{64}$/;
function validRecord(value: unknown): value is WriteRecord {
  if (!value || typeof value !== 'object') { return false; }
  const { hash, parent, by, at } = value as Record<string, unknown>;
  return typeof hash === 'string' && HASH.test(hash)
    && (parent === null || typeof parent === 'string' && HASH.test(parent))
    && (by === 'mirror' || by === 'app') && typeof at === 'number' && Number.isFinite(at) && at >= 0;
}

function parseRecords(text: string): WriteRecords | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!value || typeof value !== 'object') { return undefined; }
  const { version, files } = value as Record<string, unknown>;
  if (version !== 1 || !files || typeof files !== 'object' || Array.isArray(files)) { return undefined; }
  const records: WriteRecords = new Map();
  for (const [path, entries] of Object.entries(files)) {
    if (checkRelativePath(path) || !Array.isArray(entries) || !entries.every(validRecord)) { return undefined; }
    records.set(path, entries.slice(-50));
  }
  return records;
}

const MODULE = 'library.writeRecords';
const pending = new WeakMap<WriteRecordFileSystem, Map<string, Promise<void>>>();
const directory = (folder: string) => `${folder.replace(/\/+$/, '')}/.labshelf/writes`;

async function readDevice(fs: WriteRecordFileSystem, file: string, logger: ILogger): Promise<WriteRecords> {
  const records = parseRecords(await fs.readText(file));
  if (records) { return records; }
  await logger.log('WARN', MODULE, 'Treated an invalid write record file as empty', { file });
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
  catch (error) { await logger.error(MODULE, error, { folder, deviceId, path: entry.path }); throw error; }
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
  } catch (error) { await logger.error(MODULE, error, { folder }); throw error; }
}
