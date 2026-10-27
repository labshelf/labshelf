// Records app-authored project text versions with the bytes present before their save.
import { createWriteRecordStore, type DeviceIdentity } from '../../../library/writeRecords/index.js';
import { NodeLibraryFileSystem } from '../../../library/node/index.js';
import type { ILogger } from '../../../ports/index.js';
import { deriveTextSha256Hex } from '../../../hash/index.js';
import type { IProjectVersionStore } from '../index.js';

const recordFileSystem = new NodeLibraryFileSystem();

export interface ProjectWrite {
  folder: string;
  projectId: string;
  relativePath: string;
  text: string;
  parentText: string | undefined;
  store: IProjectVersionStore;
  identity: DeviceIdentity;
  logger: ILogger;
}

export async function addProjectWriteRecord(save: ProjectWrite): Promise<void> {
  const { store, projectId, relativePath, text, parentText, logger } = save;
  try {
    if (parentText !== undefined) await store.retain(projectId, relativePath, parentText);
    await store.retain(projectId, relativePath, text);
    await createWriteRecordStore(recordFileSystem, save.folder, save.identity, logger).append({
      path: relativePath, hash: await deriveTextSha256Hex(text), parent: parentText === undefined ? null : await deriveTextSha256Hex(parentText), by: 'app', at: Date.now(),
    });
  } catch (error) {
    await logger.error('writing-merge', error, { projectId, path: relativePath, action: 'record project save' });
    throw error;
  }
}

export async function addProjectWrite(save: ProjectWrite): Promise<void> {
  await addProjectWriteRecord(save);
  await save.store.remember(save.projectId, save.relativePath, save.text);
}
