// Finds unresolved project conflicts from recorded versions or sync copies.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import {
  createDeviceIdentity,
  createDeviceLocalLayout,
  NodeLibraryFileSystem,
  writeFileAtomic,
} from "../../../library/node/index.js";
import { scanProjectContentConflicts } from "../../../library/conflicts/node/index.js";
import { readSharedProjectFiles } from "../../../library/conflicts/node/project/index.js";
import { isEligibleProjectConflictPath, parseConflictName, type ConflictCopy } from "../../../library/conflicts/index.js";
import type { ILogger } from "../../../ports/index.js";
import { listProjectFiles } from "../../project/folder/index.js";
import { listLibraryProjects, nodeFileReads } from "../../project/node/index.js";
import { hasMergeableExtension, isMergeableTextFile, type IProjectVersionStore, deriveTextHash } from "../index.js";
import { mergeProjectCopies } from "./projectCopyMerge.js";
import { createWriteRecordStore, recordFor } from "../../../library/writeRecords/index.js";
import { addProjectWriteRecord } from "./projectWriteRecord.js";
import { mergeFileText } from "./mergeText.js";

interface DivergenceFile {
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
  await addProjectWriteRecord({ ...input, text: local, parentText: other, identity: createDeviceIdentity(createDeviceLocalLayout(input.root), input.logger) });
  await writeFileAtomic(file, local);
  await store.remember(projectId, relativePath, local);
}

async function preserveOverlap(input: DivergenceFile, local: string, other: string): Promise<ConflictCopy> {
  const { file, projectId, store, relativePath } = input;
  // INVARIANT: publish the other text before restoring local so interruption keeps both versions.
  const copy = `${file}.labshelf-conflict-${randomUUID()}`;
  await addProjectWriteRecord({ ...input, relativePath: path.relative(input.folder, copy).split(path.sep).join('/'),
    text: other, parentText: undefined, identity: createDeviceIdentity(createDeviceLocalLayout(input.root), input.logger) });
  await fs.writeFile(copy, other, { flag: 'wx' });
  await store.setPending(projectId, relativePath, path.basename(copy));
  if (await fs.readFile(file, 'utf8') !== other) throw new Error(`Project file changed during divergence recovery: ${file}`);
  await restoreLocal(input, local, other);
  await input.logger.log('INFO', 'writing-merge', 'Project divergence needs resolution', { projectId, path: relativePath, copy });
  return { owner: { kind: 'project', id: projectId }, original: file, copy, tool: 'app' };
}

async function mergeProjectDivergence(input: DivergenceFile): Promise<ConflictCopy | undefined> {
  const { store, projectId, relativePath, file, folder, logger } = input;
  const bytes = await fs.readFile(file);
  if (!isMergeableTextFile(path.basename(file), bytes)) return undefined;
  const other = bytes.toString('utf8');
  const pending = await pendingConflict(input, other);
  if (pending) return pending;
  const local = await store.latest(projectId, relativePath);
  const diskHash = await deriveTextHash(other);
  if (local === undefined || local === other) { await store.remember(projectId, relativePath, other); return undefined; }
  const identity = createDeviceIdentity(createDeviceLocalLayout(input.root), logger);
  const records = createWriteRecordStore(new NodeLibraryFileSystem(), folder, identity, logger);
  const record = recordFor(await records.read(), relativePath, diskHash);
  const base = record?.parent ? await store.version(projectId, relativePath, record.parent) : undefined;
  if (!record) return undefined;
  if (record.parent === await deriveTextHash(local) || base === undefined) {
    await store.remember(projectId, relativePath, other);
    return undefined;
  }
  const merged = mergeFileText(path.basename(file), { base, local, other, otherLabel: 'other device' });
  if (await fs.readFile(file, 'utf8') !== other) throw new Error(`Project file changed during divergence recovery: ${file}`);
  if (merged.conflicted) return preserveOverlap(input, local, other);
  await addProjectWriteRecord({ ...input, text: merged.text, parentText: other, identity });
  await writeFileAtomic(file, merged.text);
  await store.remember(projectId, relativePath, merged.text);
  await logger.log('INFO', 'writing-merge', 'Merged divergent project versions', { projectId, path: relativePath });
  input.onMerged(file);
  return undefined;
}

const MODULE = "writing-merge";

interface ProjectTree {
  /** Project-relative ("/"-separated) path by absolute path, for every file that is not a conflict copy. */
  files: Map<string, string>;
  /** The conflict copies of each original, by the original's absolute path. */
  copies: Map<string, ConflictCopy[]>;
}

async function projectTree(root: string, folder: string, projectId: string, store: IProjectVersionStore, logger: ILogger, knownPaths?: ReadonlySet<string>): Promise<ProjectTree> {
  const tree: ProjectTree = { files: new Map(), copies: new Map() };
  for (const relative of await listProjectFiles(nodeFileReads, folder)) {
    if (!isEligibleProjectConflictPath(relative)) continue;
    const file = path.join(folder, relative);
    const name = path.basename(file);
    if (name.startsWith(".")) { continue; }
    if (knownPaths?.has(relative)) { tree.files.set(file, relative); continue; }
    const parsed = parseConflictName(name);
    if (!parsed) { tree.files.set(file, path.relative(folder, file).split(path.sep).join("/")); continue; }
    const original = path.join(path.dirname(file), parsed.original);
    const copy: ConflictCopy = { owner: { kind: "project", id: projectId }, original, copy: file, tool: parsed.tool };
    tree.copies.set(original, [...tree.copies.get(original) ?? [], copy]);
  }
  for (const copy of await scanProjectContentConflicts({ root, folder, projectId, logger }, store, knownPaths)) {
    tree.files.delete(copy.copy);
    tree.copies.set(copy.original, [...tree.copies.get(copy.original) ?? [], copy]);
  }
  for (const copies of tree.copies.values()) { copies.sort((a, b) => a.copy.localeCompare(b.copy)); }
  return tree;
}

// A conflict copy makes the original unsafe as an ancestor: seeding it would discard its edits.
async function seedBases(projectId: string, tree: ProjectTree, store: IProjectVersionStore, logger: ILogger): Promise<void> {
  for (const [file, rel] of tree.files) {
    if (tree.copies.has(file) || !hasMergeableExtension(path.basename(file))) { continue; }
    try {
      if (await store.read(projectId, rel) !== undefined) { continue; }
      const bytes = await fs.readFile(file);
      if (isMergeableTextFile(path.basename(file), bytes)) { await store.write(projectId, rel, bytes.toString("utf8")); }
    } catch (error) {
      void logger.error(MODULE, error, { projectId, path: rel, action: "seed a merge base" });
    }
  }
}

async function scanProject(root: string, folder: string, projectId: string, store: IProjectVersionStore, logger: ILogger, onMerged: (file: string) => void): Promise<ConflictCopy[]> {
  const tree = await projectTree(root, folder, projectId, store, logger);
  const unresolved: ConflictCopy[] = [];
  for (const [file, relativePath] of tree.files) {
    if (!hasMergeableExtension(path.basename(file))) continue;
    if (tree.copies.get(file)?.some(copy => copy.tool === "app") && !await store.pending(projectId, relativePath)) continue;
    const conflict = await mergeProjectDivergence({ root, folder, projectId, file, relativePath, store, logger, onMerged });
    if (conflict) { unresolved.push(conflict); tree.copies.delete(file); }
  }
  await seedBases(projectId, tree, store, logger);
  for (const [original, copies] of tree.copies) {
    const rel = path.relative(folder, original).split(path.sep).join("/");
    if (copies.some(copy => copy.tool === "app" || copy.match === "record" || copy.match === "similar") || !await mergeProjectCopies(copies, rel, store, logger, { folder, identity: createDeviceIdentity(createDeviceLocalLayout(root), logger) })) { unresolved.push(...copies); }
  }
  return unresolved;
}

/** @returns the project conflict copies left for the user; a project that cannot be listed is logged and skipped. */
export async function scanProjectConflicts(libraryRoot: string, store: IProjectVersionStore, logger: ILogger, onMerged: (file: string) => void): Promise<ConflictCopy[]> {
  const unresolved: ConflictCopy[] = [];
  for (const entry of await listLibraryProjects(libraryRoot, logger)) {
    if (entry.kind !== "ready" || entry.settings.shared) { continue; }
    try {
      unresolved.push(...await scanProject(libraryRoot, entry.folder, entry.settings.id, store, logger, onMerged));
    } catch (error) {
      void logger.error(MODULE, error, { projectId: entry.settings.id, folder: entry.folder, action: "scan project conflicts" });
    }
  }
  return unresolved;
}

export async function scanSharedProjectConflicts(root: string, store: IProjectVersionStore, logger: ILogger): Promise<ConflictCopy[]> {
  const unresolved: ConflictCopy[] = [];
  for (const entry of await listLibraryProjects(root, logger)) {
    if (entry.kind !== 'ready' || !entry.settings.shared) continue;
    try {
      const knownPaths = await readSharedProjectFiles(root, entry.settings.shared, logger);
      const tree = await projectTree(root, entry.folder, entry.settings.id, store, logger, knownPaths);
      unresolved.push(...[...tree.copies.values()].flat());
    } catch (error) {
      await logger.error(MODULE, error, { projectId: entry.settings.id, action: 'scan shared project conflicts' });
    }
  }
  return unresolved.sort((a, b) => a.copy.localeCompare(b.copy));
}
