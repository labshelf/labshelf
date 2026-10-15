// Classifies the children of one papers/ directory as papers, orphans (paper.pdf only) or collections.
// PLATFORM: a symlinked folder or file counts as absent because the port's stat reports it as neither.
import { METADATA_FILE, PDF_FILE } from "../layout.js";
import { nameCollator } from "../model/index.js";
import type { LocalStat } from "../../ports/index.js";
import { errorMessage } from "../../logging/index.js";
import { warnSkipped, type ScanEnv } from "./scanEnv.js";

export interface PaperFolder {
  path: string;
  metadata: LocalStat;
  pdf?: LocalStat;
}

export interface FolderLevel {
  /** Collection folders, sorted by name. */
  collections: string[];
  papers: PaperFolder[];
  /** Folders that hold a paper.pdf and no metadata.yaml. */
  orphans: string[];
}

type Child =
  | { kind: "paper"; folder: PaperFolder }
  | { kind: "orphan" | "collection"; path: string };

async function statFile(env: ScanEnv, path: string): Promise<LocalStat | undefined> {
  const stat = await env.limit(() => env.fs.stat(path));
  return stat?.isFile ? stat : undefined;
}

async function classify(env: ScanEnv, path: string): Promise<Child | undefined> {
  const stat = await env.limit(() => env.fs.stat(path));
  if (!stat?.isDirectory) { return undefined; }
  // The listing carries the exact names; a stat alone would match "Paper.pdf" on a case-insensitive disk.
  const names = new Set(await env.limit(() => env.fs.listDir(path)));
  const metadata = names.has(METADATA_FILE) ? await statFile(env, env.ops.join(path, METADATA_FILE)) : undefined;
  const pdf = names.has(PDF_FILE) ? await statFile(env, env.ops.join(path, PDF_FILE)) : undefined;
  if (metadata) { return { kind: "paper", folder: { path, metadata, ...(pdf ? { pdf } : {}) } }; }
  return { kind: pdf ? "orphan" : "collection", path };
}

/**
 * Reads one directory level. A child that cannot be read is logged and left out; a failure to list `dir` itself is thrown.
 * @returns the collections, papers and orphans directly inside `dir`
 */
export async function readFolderLevel(env: ScanEnv, dir: string): Promise<FolderLevel> {
  const names = (await env.limit(() => env.fs.listDir(dir))).filter((name) => !name.startsWith("."));
  const children = await Promise.all(names.map(async (name): Promise<Child | undefined> => {
    const path = env.ops.join(dir, name);
    try {
      return await classify(env, path);
    } catch (error) {
      await warnSkipped(env, "Folder skipped: it could not be read", { path, message: errorMessage(error) });
      return undefined;
    }
  }));
  const level: FolderLevel = { collections: [], papers: [], orphans: [] };
  for (const child of children) {
    if (child?.kind === "paper") { level.papers.push(child.folder); }
    else if (child?.kind === "orphan") { level.orphans.push(child.path); }
    else if (child) { level.collections.push(child.path); }
  }
  level.collections.sort((a, b) => nameCollator.compare(env.ops.basename(a), env.ops.basename(b)));
  return level;
}
