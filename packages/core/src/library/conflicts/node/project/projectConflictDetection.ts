// Reads project texts for the shared content-copy detector.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { deviceLocalLayout, NodeLibraryFileSystem } from '../../../node/index.js';
import { readWriteRecords } from '../../../writeRecords/index.js';
import { detectProjectConflict, eligibleProjectConflictPath, readConflictDismissals, parseConflictName } from '../../index.js';
import type { ConflictCopy, ProjectConflictText } from '../../index.js';
import type { ILogger } from '../../../../ports/index.js';
import { isMergeableTextFile, type IProjectVersionStore } from '../../../../writing/merge/index.js';
import { listProjectFiles } from '../../../../writing/project/folder/index.js';
import { nodeFileReads } from '../../../../writing/project/node/index.js';

export interface ProjectConflictLocation { root: string; folder: string; projectId: string; logger: ILogger }
export function conflictDismissalFile(root: string): string {
  return path.join(path.dirname(deviceLocalLayout(root).mergeBasesDir), 'conflict-dismissals.json');
}
const disk = new NodeLibraryFileSystem();
export async function projectConflictSnapshot(input: ProjectConflictLocation) {
  const files: ProjectConflictText[] = [];
  for (const relative of await listProjectFiles(nodeFileReads, input.folder)) {
    if (!eligibleProjectConflictPath(relative)) continue;
    const file = path.join(input.folder, relative);
    const bytes = await fs.readFile(file);
    if (isMergeableTextFile(path.basename(file), bytes)) files.push({ path: relative, text: bytes.toString('utf8') });
  }
  const records = await readWriteRecords(disk, input.folder, input.logger);
  const dismissed = (await readConflictDismissals(disk, conflictDismissalFile(input.root)))
    .map(entry => ({ ...entry, path: path.relative(input.folder, entry.path).split(path.sep).join('/') }));
  return { files, records, dismissed };
}
export async function findProjectConflict(input: ProjectConflictLocation & { file: string }): Promise<ConflictCopy | undefined> {
  const snapshot = await projectConflictSnapshot(input);
  const relative = path.relative(input.folder, input.file).split(path.sep).join('/');
  const candidate = snapshot.files.find(file => file.path === relative);
  if (!candidate) return undefined;
  const conflict = await detectProjectConflict({ ...candidate, ...snapshot, siblings: snapshot.files, projectId: input.projectId });
  return conflict && absoluteConflict(input.folder, conflict);
}
export function absoluteConflict(folder: string, conflict: ConflictCopy): ConflictCopy {
  return { ...conflict, original: path.join(folder, conflict.original), copy: path.join(folder, conflict.copy) };
}
export async function scanProjectContentConflicts(input: ProjectConflictLocation, store: IProjectVersionStore, knownPaths?: ReadonlySet<string>): Promise<ConflictCopy[]> {
  const snapshot = await projectConflictSnapshot(input);
  const dismissedPaths = new Set(snapshot.dismissed.map(entry => entry.path));
  const ordered = await Promise.all(snapshot.files.filter(file => !parseConflictName(path.basename(file.path))).map(async file => ({
    ...file, known: !dismissedPaths.has(file.path) && (snapshot.records.has(file.path) || await store.latest(input.projectId, file.path) !== undefined),
  })));
  ordered.sort((a, b) => Number(knownPaths?.has(b.path) ?? false) - Number(knownPaths?.has(a.path) ?? false)
    || Number(b.known) - Number(a.known) || a.path.length - b.path.length || a.path.localeCompare(b.path));
  const siblings: ProjectConflictText[] = [];
  const conflicts: ConflictCopy[] = [];
  for (const file of ordered) {
    const conflict = file.known || knownPaths?.has(file.path) ? undefined : await detectProjectConflict({ ...file, ...snapshot, siblings, projectId: input.projectId });
    if (conflict) conflicts.push(absoluteConflict(input.folder, conflict));
    else siblings.push(file);
  }
  return conflicts;
}
