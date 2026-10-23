// Reads validated shared-project history without changing live collaboration state.
import * as path from 'node:path';
import { loadVersionHistory, PersistedMap } from '../../../../collab/state/index.js';
import type { ILogger } from '../../../../ports/index.js';
import { textHash } from '../../../../writing/merge/index.js';
import { parseProjectFile, PROJECT_FILE } from '../../../../writing/project/index.js';
import { readOptionalFile } from '../../../node/index.js';
import { sharedProjectStorage } from './sharedProjectStorage.js';

export async function readSharedProjectVersions(root: string, folder: string, relative: string, logger: ILogger): Promise<string[]> {
  const settings = await readOptionalFile(path.join(folder, PROJECT_FILE));
  if (settings === undefined) return [];
  const project = parseProjectFile(settings);
  if (!project.ok) throw new Error(`Cannot read project settings for merge history: ${folder}: ${project.reason}`);
  const shareId = project.settings.shared;
  if (!shareId) return [];
  const storage = sharedProjectStorage(root, shareId);
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
