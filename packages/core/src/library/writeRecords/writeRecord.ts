// Declares per-device file version records shared through a project folder.
import type { LibraryFileSystem } from '../../ports/index.js';

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
