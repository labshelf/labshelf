// Finds conflict copies in writing projects: seeds missing merge bases, merges text copies and lists the rest.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { parseConflictName, type ConflictCopy } from "../../../library/conflicts/index.js";
import type { ILogger } from "../../../ports/index.js";
import { listProjectFiles, listProjects } from "../../project/node/index.js";
import { hasMergeableExtension, isMergeableTextFile } from "../mergeableTextFile.js";
import type { IMergeBaseStore } from "../mergeBaseStore.js";
import { mergeProjectCopies } from "./projectCopyMerge.js";

const MODULE = "writing-merge";

interface ProjectTree {
  /** Project-relative ("/"-separated) path by absolute path, for every file that is not a conflict copy. */
  files: Map<string, string>;
  /** The conflict copies of each original, by the original's absolute path. */
  copies: Map<string, ConflictCopy[]>;
}

async function projectTree(folder: string, projectId: string): Promise<ProjectTree> {
  const tree: ProjectTree = { files: new Map(), copies: new Map() };
  for (const file of await listProjectFiles(folder)) {
    const name = path.basename(file);
    if (name.startsWith(".")) { continue; }
    const parsed = parseConflictName(name);
    if (!parsed) { tree.files.set(file, path.relative(folder, file).split(path.sep).join("/")); continue; }
    const original = path.join(path.dirname(file), parsed.original);
    const copy: ConflictCopy = { owner: { kind: "project", id: projectId }, original, copy: file, tool: parsed.tool };
    tree.copies.set(original, [...tree.copies.get(original) ?? [], copy]);
  }
  for (const copies of tree.copies.values()) { copies.sort((a, b) => a.copy.localeCompare(b.copy)); }
  return tree;
}

/**
 * A text file seen with no base gets its content as the base. A file with a conflict copy is not seeded:
 * its content may already differ from the other device's, and a base equal to it would let the copy win.
 */
async function seedBases(projectId: string, tree: ProjectTree, store: IMergeBaseStore, logger: ILogger): Promise<void> {
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

async function scanProject(folder: string, projectId: string, store: IMergeBaseStore, logger: ILogger): Promise<ConflictCopy[]> {
  const tree = await projectTree(folder, projectId);
  await seedBases(projectId, tree, store, logger);
  const unresolved: ConflictCopy[] = [];
  for (const [original, copies] of tree.copies) {
    const rel = path.relative(folder, original).split(path.sep).join("/");
    if (!await mergeProjectCopies(copies, rel, store, logger)) { unresolved.push(...copies); }
  }
  return unresolved;
}

/** @returns the project conflict copies left for the user; a project that cannot be listed is logged and skipped. */
export async function scanProjectConflicts(libraryRoot: string, store: IMergeBaseStore, logger: ILogger): Promise<ConflictCopy[]> {
  const unresolved: ConflictCopy[] = [];
  for (const entry of await listProjects(libraryRoot, logger)) {
    if (entry.kind !== "ready") { continue; }
    try {
      unresolved.push(...await scanProject(entry.folder, entry.settings.id, store, logger));
    } catch (error) {
      void logger.error(MODULE, error, { projectId: entry.settings.id, folder: entry.folder, action: "scan project conflicts" });
    }
  }
  return unresolved;
}
