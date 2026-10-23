// Finds unresolved project conflicts from recorded versions or sync copies.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createDeviceIdentity, deviceLocalLayout } from "../../../library/node/index.js";
import { scanProjectContentConflicts } from "../../../library/conflicts/node/index.js";
import { readSharedProjectFiles } from "../../../library/conflicts/node/project/index.js";
import { eligibleProjectConflictPath, parseConflictName, type ConflictCopy } from "../../../library/conflicts/index.js";
import type { ILogger } from "../../../ports/index.js";
import { listProjectFiles } from "../../project/folder/index.js";
import { listProjectsOnDisk, nodeFileReads } from "../../project/node/index.js";
import { hasMergeableExtension, isMergeableTextFile } from "../index.js";
import type { IProjectVersionStore } from "../index.js";
import { mergeProjectDivergence } from "./projectDivergence.js";
import { mergeProjectCopies } from "./projectCopyMerge.js";

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
    if (!eligibleProjectConflictPath(relative)) continue;
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
    if (copies.some(copy => copy.tool === "app" || copy.match === "record" || copy.match === "similar") || !await mergeProjectCopies(copies, rel, store, logger, { folder, identity: createDeviceIdentity(deviceLocalLayout(root), logger) })) { unresolved.push(...copies); }
  }
  return unresolved;
}

/** @returns the project conflict copies left for the user; a project that cannot be listed is logged and skipped. */
export async function scanProjectConflicts(libraryRoot: string, store: IProjectVersionStore, logger: ILogger, onMerged: (file: string) => void): Promise<ConflictCopy[]> {
  const unresolved: ConflictCopy[] = [];
  for (const entry of await listProjectsOnDisk(libraryRoot, logger)) {
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
  for (const entry of await listProjectsOnDisk(root, logger)) {
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
