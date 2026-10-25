// Resolves content-matched project copies without discarding either side's edits.
import { promises as fs } from 'node:fs';
import * as path from "node:path";
import {
  createDeviceIdentity,
  createDeviceLocalLayout,
  NodeLibraryFileSystem,
  readOptionalFile,
} from "../../../node/index.js";
import { writeProjectConflictDismissal, type ConflictCopy } from '../../index.js';
import type { ILogger } from "../../../../ports/index.js";
import { textHash, type IProjectVersionStore } from "../../../../writing/conflict/index.js";
import { lineSimilarity } from '../../../../writing/text/index.js';
import { mergeProjectContentCopy } from '../../../../writing/conflict/node/index.js';
import { listProjectsOnDisk } from '../../../../writing/project/node/index.js';
import { resolveConflictDismissalFile, findProjectConflict } from './projectConflictDetection.js';
import { loadVersionHistory, PersistedMap } from "../../../../collab/deviceState/index.js";
import { parseProjectFile, PROJECT_FILE } from "../../../../writing/project/index.js";
import { createSharedProjectStorage } from "./createSharedProjectStorage.js";

async function readSharedProjectVersions(root: string, folder: string, relative: string, logger: ILogger): Promise<string[]> {
  const settings = await readOptionalFile(path.join(folder, PROJECT_FILE));
  if (settings === undefined) return [];
  const project = parseProjectFile(settings);
  if (!project.ok) throw new Error(`Cannot read project settings for merge history: ${folder}: ${project.reason}`);
  const shareId = project.settings.shared;
  if (!shareId) return [];
  const storage = createSharedProjectStorage(root, shareId);
  const versions = await loadVersionHistory(storage, logger);
  const texts: string[] = [];
  for (const version of versions.storedVersions(relative)) {
    if (await textHash(version.text) === version.hash) texts.push(version.text);
    else await logger.log('WARN', 'conflicts', 'Ignored a shared text version with a mismatched hash', { shareId, path: relative, hash: version.hash });
  }
  const bases = await PersistedMap.load({ storage, name: 'bases', label: 'file merge bases', logger,
    isValue: (value: unknown): value is string => typeof value === 'string' });
  const base = bases.get(relative);
  if (base !== undefined) texts.push(base);
  return texts;
}

export interface ProjectConflictResolutionContext {
  root: string; folder?: string; store: IProjectVersionStore; logger: ILogger;
}
async function projectFolder(conflict: ConflictCopy, context: ProjectConflictResolutionContext): Promise<string> {
  if (context.folder) return context.folder;
  const entry = (await listProjectsOnDisk(context.root, context.logger)).find(entry => entry.kind === 'ready' && entry.settings.id === conflict.owner.id);
  if (!entry || entry.kind !== 'ready') throw new Error(`Project not found for conflict: ${conflict.copy}`);
  return entry.folder;
}
async function similarBase(folder: string, conflict: ConflictCopy, store: IProjectVersionStore, text: string, root: string, logger: ILogger): Promise<string | undefined> {
  const relative = path.relative(folder, conflict.original).split(path.sep).join('/');
  const versions = await store.versions(conflict.owner.id, relative);
  versions.push(...await readSharedProjectVersions(root, folder, relative, logger));
  const base = await store.read(conflict.owner.id, relative);
  if (base !== undefined) versions.push(base);
  return versions.filter((version): version is string => version !== undefined)
    .sort((a, b) => lineSimilarity(b, text) - lineSimilarity(a, text))[0];
}
export async function resolveProjectConflictCopy(
  conflict: ConflictCopy, resolution: 'mergeAutomatically' | 'notAVersion', context: ProjectConflictResolutionContext,
): Promise<void> {
  try {
    if (conflict.owner.kind !== 'project' || !['record', 'similar'].includes(conflict.match ?? '')) throw new Error(`Not a content conflict: ${conflict.copy}`);
    const folder = await projectFolder(conflict, context);
    const relativeCopy = path.relative(folder, conflict.copy);
    if (relativeCopy.startsWith('..') || path.isAbsolute(relativeCopy)) throw new Error(`Conflict copy escapes project: ${conflict.copy}`);
    const detected = await findProjectConflict({ ...context, folder, projectId: conflict.owner.id, file: conflict.copy });
    if (!detected || detected.original !== conflict.original) throw new Error(`Conflict copy changed before resolution: ${conflict.copy}`);
    const text = await fs.readFile(conflict.copy, 'utf8');
    if (resolution === 'notAVersion') {
      await writeProjectConflictDismissal(new NodeLibraryFileSystem(), resolveConflictDismissalFile(context.root), conflict.copy, await textHash(text));
    } else if (resolution === 'mergeAutomatically') {
      const base = await similarBase(folder, conflict, context.store, text, context.root, context.logger);
      await mergeProjectContentCopy(conflict, path.relative(folder, conflict.original).split(path.sep).join('/'), context.store, context.logger,
        { folder, identity: createDeviceIdentity(createDeviceLocalLayout(context.root), context.logger) }, base);
    } else throw new Error(`Invalid project conflict resolution: ${resolution}`);
    await context.logger.log('INFO', 'conflicts', 'Resolved project content copy', { ...conflict, resolution });
  } catch (error) {
    await context.logger.error('conflicts', error, { ...conflict, resolution });
    throw error;
  }
}
