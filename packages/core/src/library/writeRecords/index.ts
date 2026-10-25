// Exposes per-device project write history through a runtime-neutral file port.
import type { ILogger } from '../../ports/index.js';
import type { DeviceIdentity, WriteRecordFileSystem, WriteRecords, WriteRecordStore } from './writeRecord.js';
import { addWriteRecord, readWriteRecords } from './writeRecords.js';
export { addWriteRecord, readWriteRecords };
export { DEVICE_ID } from './writeRecord.js';
export type { DeviceIdentity, WriteRecord, WriteRecordEntry, WriteRecordFileSystem, WriteRecords, WriteRecordStore } from './writeRecord.js';

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
