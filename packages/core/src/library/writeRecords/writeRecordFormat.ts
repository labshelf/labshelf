// Validates write record files arriving from another device.
import { relativePathProblem } from '../index.js';
import type { WriteRecord, WriteRecords } from './writeRecord.js';

const HASH = /^[0-9a-f]{64}$/;
export function validRecord(value: unknown): value is WriteRecord {
  if (!value || typeof value !== 'object') { return false; }
  const { hash, parent, by, at } = value as Record<string, unknown>;
  return typeof hash === 'string' && HASH.test(hash)
    && (parent === null || typeof parent === 'string' && HASH.test(parent))
    && (by === 'mirror' || by === 'app') && typeof at === 'number' && Number.isFinite(at) && at >= 0;
}

export function parseRecords(text: string): WriteRecords | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!value || typeof value !== 'object') { return undefined; }
  const { version, files } = value as Record<string, unknown>;
  if (version !== 1 || !files || typeof files !== 'object' || Array.isArray(files)) { return undefined; }
  const records: WriteRecords = new Map();
  for (const [path, entries] of Object.entries(files)) {
    if (relativePathProblem(path) || !Array.isArray(entries) || !entries.every(validRecord)) { return undefined; }
    records.set(path, entries.slice(-50));
  }
  return records;
}
