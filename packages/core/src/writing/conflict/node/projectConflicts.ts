// Merges, detects and resolves copies of a writing project's files on disk, using its write records, version store and shared state.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createDeviceIdentity, createDeviceLocalLayout, NodeLibraryFileSystem, writeFileAtomic } from '../../../library/node/index.js';
import { readWriteRecords, type DeviceIdentity } from '../../../library/index.js';
import {
  isItemFileName, isMergeableTextFile, parseConflictName, readConflictDismissals, writeProjectConflictDismissal,
  type ConflictCopy, type IProjectVersionStore,
} from '../../../library/conflicts/index.js';
import { detectProjectConflict, isEligibleProjectConflictPath, type ProjectConflictText } from '../projectConflicts.js';
import type { ILogger } from '../../../ports/index.js';
import { deriveTextSha256Hex } from '../../../hash/index.js';
import { deriveLineSimilarity } from '../../text/index.js';
import { listProjectFiles } from '../../project/index.js';
import { listLibraryProjects, nodeFileReads } from '../../project/node/index.js';
import { isInside } from '../../../path/index.js';
import { nodePathOps } from '../../../path/node/index.js';
import { addProjectWriteRecord } from './projectWrite.js';
import { mergeFileText } from './itemFileMerge.js';
import { readSharedProjectVersions } from './sharedProjectState.js';

// Copy merge: one project text file merged three-way against its merge base.

const MODULE = "writing-merge";

async function readOrUndefined(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

/** The file as text, or undefined when it is missing, binary or not UTF-8. */
async function readText(file: string, name: string): Promise<string | undefined> {
  const bytes = await readOrUndefined(file);
  // Buffer decoding keeps a byte-order mark, which TextDecoder would strip from the written file.
  return bytes && isMergeableTextFile(name, bytes) ? bytes.toString("utf8") : undefined;
}

/** Folds every copy into the local text against the same base; chaining keeps each side's edits. */
function mergeAll(name: string, base: string | undefined, local: string, copies: ConflictCopy[], others: string[]): { text: string; conflicted: boolean } {
  let result = { text: local, conflicted: false };
  copies.forEach((copy, i) => {
    const next = mergeFileText(name, { base, local: result.text, other: others[i] ?? "", otherLabel: copy.tool });
    result = { text: next.text, conflicted: result.conflicted || next.conflicted };
  });
  return result;
}

// INVARIANT: only a single copy supplies the ancestor from which the other device keeps editing.
// CONTRACT: documents/contracts/library-format.md#conflict-copies
export async function mergeProjectCopies(
  copies: ConflictCopy[], relativePath: string, store: IProjectVersionStore, logger: ILogger,
  recording: { folder: string; identity: DeviceIdentity }, selectedBase?: string,
): Promise<boolean> {
  const [first] = copies;
  if (!first) { return true; }
  const name = path.basename(first.original);
  const context = { projectId: first.owner.id, path: relativePath, copies: copies.map((copy) => copy.copy) };
  try {
    const base = selectedBase ?? await store.read(first.owner.id, relativePath);
    const local = base === undefined && !isItemFileName(name) ? undefined : await readText(first.original, name);
    const others = await Promise.all(copies.map((copy) => readText(copy.copy, name)));
    if (local === undefined || others.some((other) => other === undefined)) { return false; }
    const merged = mergeAll(name, base, local, copies, others as string[]);
    if (await readText(first.original, name) !== local) {
      void logger.log("INFO", MODULE, "File changed during the merge; the next scan merges it", context);
      return false;
    }
    await addProjectWriteRecord({ ...recording, projectId: first.owner.id, relativePath, store, logger, text: merged.text, parentText: local });
    await writeFileAtomic(first.original, merged.text);
    if (await fs.readFile(first.original, "utf8") !== merged.text) {
      throw new Error(`Merged file ${first.original} reads back different content`);
    }
    await store.remember(first.owner.id, relativePath, merged.text);
    for (const [index, copy] of copies.entries()) {
      if (await readText(copy.copy, name) !== others[index]) throw new Error(`Conflict copy changed during merge: ${copy.copy}`);
    }
    for (const copy of copies) { await fs.rm(copy.copy); }
    void logger.log("INFO", MODULE, "Merged project conflict copies", { ...context, conflicted: merged.conflicted });
    // An item file keeps its base: a copy may be this device's own version, and a stale base only brings items back.
    if (copies.length === 1 && others[0] !== undefined && !isItemFileName(name)) {
      await store.write(first.owner.id, relativePath, others[0]).catch((error: unknown) => {
        void logger.error(MODULE, error, { ...context, action: "store the merged copy as the base" });
      });
    }
    return true;
  } catch (error) {
    void logger.error(MODULE, error, { ...context, action: "merge project conflict copies" });
    return false;
  }
}

// CONTRACT: documents/contracts/library-format.md#conflict-copies
export async function mergeProjectContentCopy(
  conflict: ConflictCopy, relativePath: string, store: IProjectVersionStore, logger: ILogger,
  recording: { folder: string; identity: DeviceIdentity }, base: string | undefined,
): Promise<void> {
  if (base === undefined) await logger.log('INFO', MODULE, 'Falling back to the project copy merge base', { path: relativePath, projectId: conflict.owner.id });
  if (!await mergeProjectCopies([conflict], relativePath, store, logger, recording, base)) {
    throw new Error(`Cannot merge project copy without readable text and a base: ${conflict.copy}`);
  }
}

// Detection: project texts read from disk for the shared content-copy detector.

interface ProjectConflictLocation { root: string; folder: string; projectId: string; logger: ILogger }
export function resolveConflictDismissalFile(root: string): string {
  return path.join(path.dirname(createDeviceLocalLayout(root).mergeBasesDir), 'conflict-dismissals.json');
}
const disk = new NodeLibraryFileSystem();
async function projectConflictSnapshot(input: ProjectConflictLocation) {
  const files: ProjectConflictText[] = [];
  for (const relative of await listProjectFiles(nodeFileReads, input.folder)) {
    if (!isEligibleProjectConflictPath(relative)) continue;
    const file = path.join(input.folder, relative);
    const bytes = await fs.readFile(file);
    if (isMergeableTextFile(path.basename(file), bytes)) files.push({ path: relative, text: bytes.toString('utf8') });
  }
  const records = await readWriteRecords(disk, input.folder, input.logger);
  const dismissed = (await readConflictDismissals(disk, resolveConflictDismissalFile(input.root)))
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
function absoluteConflict(folder: string, conflict: ConflictCopy): ConflictCopy {
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

// Resolution: merges a content copy or dismisses it, without discarding either side's edits.

export interface ProjectConflictResolutionContext {
  root: string; folder?: string; store: IProjectVersionStore; logger: ILogger;
}
async function projectFolder(conflict: ConflictCopy, context: ProjectConflictResolutionContext): Promise<string> {
  if (context.folder) return context.folder;
  const entry = (await listLibraryProjects(context.root, context.logger)).find(entry => entry.kind === 'ready' && entry.settings.id === conflict.owner.id);
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
    .sort((a, b) => deriveLineSimilarity(b, text) - deriveLineSimilarity(a, text))[0];
}
export async function resolveProjectConflictCopy(
  conflict: ConflictCopy, resolution: 'mergeAutomatically' | 'notAVersion', context: ProjectConflictResolutionContext,
): Promise<void> {
  try {
    if (conflict.owner.kind !== 'project' || !['record', 'similar'].includes(conflict.match ?? '')) throw new Error(`Not a content conflict: ${conflict.copy}`);
    const folder = await projectFolder(conflict, context);
    if (!isInside(nodePathOps, folder, conflict.copy, { allowEqual: true })) throw new Error(`Conflict copy escapes project: ${conflict.copy}`);
    const detected = await findProjectConflict({ ...context, folder, projectId: conflict.owner.id, file: conflict.copy });
    if (!detected || detected.original !== conflict.original) throw new Error(`Conflict copy changed before resolution: ${conflict.copy}`);
    const text = await fs.readFile(conflict.copy, 'utf8');
    if (resolution === 'notAVersion') {
      await writeProjectConflictDismissal(new NodeLibraryFileSystem(), resolveConflictDismissalFile(context.root), conflict.copy, await deriveTextSha256Hex(text));
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
