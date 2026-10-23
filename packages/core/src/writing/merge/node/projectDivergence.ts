// Recovers silently overwritten project texts through their recorded common parent.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteRecordStore, recordFor } from '../../../library/writeRecords/index.js';
import { createDeviceIdentity, deviceLocalLayout, NodeLibraryFileSystem, writeFileAtomic } from '../../../library/node/index.js';
import { parseConflictName } from '../../../library/conflicts/index.js';
import type { ConflictCopy } from '../../../library/conflicts/index.js';
import type { ILogger } from '../../../ports/index.js';
import { textHash, isMergeableTextFile, type IProjectVersionStore } from '../index.js';
import { prepareProjectSave } from './projectSaveRecord.js';
import { mergeText } from './mergeText.js';

export interface DivergenceFile {
  root: string; folder: string; projectId: string; file: string; relativePath: string;
  store: IProjectVersionStore; logger: ILogger; onMerged: (file: string) => void;
}

async function pendingConflict(input: DivergenceFile, text: string): Promise<ConflictCopy | undefined> {
  const { store, projectId, relativePath, file } = input;
  const pending = await store.pending(projectId, relativePath);
  if (!pending) return undefined;
  if (parseConflictName(pending)?.original !== path.basename(file)) throw new Error(`Invalid pending project conflict: ${pending}`);
  const copy = path.join(path.dirname(file), pending);
  try {
    const other = await fs.readFile(copy, 'utf8');
    const local = await store.latest(projectId, relativePath);
    if (text === other && local !== undefined && local !== other) await restoreLocal(input, local, other);
    return { owner: { kind: 'project', id: projectId }, original: file, copy, tool: 'app' };
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await store.setPending(projectId, relativePath, undefined);
  await store.remember(projectId, relativePath, text);
  return undefined;
}

async function restoreLocal(input: DivergenceFile, local: string, other: string): Promise<void> {
  const { file, store, projectId, relativePath } = input;
  await prepareProjectSave({ ...input, text: local, parentText: other, identity: createDeviceIdentity(deviceLocalLayout(input.root), input.logger) });
  await writeFileAtomic(file, local);
  await store.remember(projectId, relativePath, local);
}

async function preserveOverlap(input: DivergenceFile, local: string, other: string): Promise<ConflictCopy> {
  const { file, projectId, store, relativePath } = input;
  // INVARIANT: publish the other text before restoring local so interruption keeps both versions.
  const copy = `${file}.labshelf-conflict-${randomUUID()}`;
  await prepareProjectSave({ ...input, relativePath: path.relative(input.folder, copy).split(path.sep).join('/'),
    text: other, parentText: undefined, identity: createDeviceIdentity(deviceLocalLayout(input.root), input.logger) });
  await fs.writeFile(copy, other, { flag: 'wx' });
  await store.setPending(projectId, relativePath, path.basename(copy));
  if (await fs.readFile(file, 'utf8') !== other) throw new Error(`Project file changed during divergence recovery: ${file}`);
  await restoreLocal(input, local, other);
  await input.logger.log('INFO', 'writing-merge', 'Project divergence needs resolution', { projectId, path: relativePath, copy });
  return { owner: { kind: 'project', id: projectId }, original: file, copy, tool: 'app' };
}

export async function mergeProjectDivergence(input: DivergenceFile): Promise<ConflictCopy | undefined> {
  const { store, projectId, relativePath, file, folder, logger } = input;
  const bytes = await fs.readFile(file);
  if (!isMergeableTextFile(path.basename(file), bytes)) return undefined;
  const other = bytes.toString('utf8');
  const pending = await pendingConflict(input, other);
  if (pending) return pending;
  const local = await store.latest(projectId, relativePath);
  const diskHash = await textHash(other);
  if (local === undefined || local === other) { await store.remember(projectId, relativePath, other); return undefined; }
  const identity = createDeviceIdentity(deviceLocalLayout(input.root), logger);
  const records = createWriteRecordStore(new NodeLibraryFileSystem(), folder, identity, logger);
  const record = recordFor(await records.read(), relativePath, diskHash);
  const base = record?.parent ? await store.version(projectId, relativePath, record.parent) : undefined;
  if (!record) return undefined;
  if (record.parent === await textHash(local) || base === undefined) {
    await store.remember(projectId, relativePath, other);
    return undefined;
  }
  const merged = mergeText({ base, local, other, otherLabel: 'other device' });
  if (await fs.readFile(file, 'utf8') !== other) throw new Error(`Project file changed during divergence recovery: ${file}`);
  if (merged.conflicted) return preserveOverlap(input, local, other);
  await prepareProjectSave({ ...input, text: merged.text, parentText: other, identity });
  await writeFileAtomic(file, merged.text);
  await store.remember(projectId, relativePath, merged.text);
  await logger.log('INFO', 'writing-merge', 'Merged divergent project versions', { projectId, path: relativePath });
  input.onMerged(file);
  return undefined;
}
