/** Reads template and project folders from disk: a symlink-refusing walk, a template tree checked against the path rules, and the files of a writing project that a template keeps. */
// CONTRACT: documents/contracts/templates.md#paths

import * as fs from "node:fs";
import * as path from "node:path";

import { comparePaths, deriveTemplateTreeProblem } from "../templateManifest/index.js";
import type { TemplateFile } from "../communitySource.js";
import { PROJECT_FILE } from "../../writing/project/index.js";

export interface FoundFile {
  /** Relative to the walked folder, segments joined by `/`. */
  path: string;
  absolute: string;
  size: number;
  nlink: number;
}

/** Whether to leave out an entry, given its `/`-joined relative path; a skipped folder is not entered. */
type SkipEntry = (relativePath: string, name: string) => boolean;

// TRAP: tar extracts symlinks and a project may hold them, so this lstat walk is the only guard between a tree and the files it points at.
async function walk(root: string, relative: string, skip: SkipEntry, found: FoundFile[]): Promise<void> {
  const directory = relative === "" ? root : path.join(root, ...relative.split("/"));
  for (const name of await fs.promises.readdir(directory)) {
    const rel = relative === "" ? name : `${relative}/${name}`;
    if (skip(rel, name)) { continue; }
    const absolute = path.join(directory, name);
    const stat = await fs.promises.lstat(absolute);
    if (stat.isSymbolicLink()) { throw new Error(`"${rel}" is a symbolic link`); }
    if (stat.isDirectory()) { await walk(root, rel, skip, found); continue; }
    if (!stat.isFile()) { throw new Error(`"${rel}" is not a regular file`); }
    found.push({ path: rel, absolute, size: stat.size, nlink: stat.nlink });
  }
}

/** The folder's files sorted by relative path; throws naming the path of the first symbolic link or special file. */
async function walkFolder(folder: string, skip: SkipEntry = () => false): Promise<FoundFile[]> {
  const root = await fs.promises.lstat(folder);
  if (!root.isDirectory()) { throw new Error(`${folder} is not a folder`); }
  const found: FoundFile[] = [];
  await walk(folder, "", skip, found);
  return found.sort((a, b) => comparePaths(a.path, b.path));
}

/** The folder's files sorted by their `/`-joined relative path; throws naming the path of the first one that breaks a rule. */
export async function readTemplateTree(folder: string): Promise<TemplateFile[]> {
  const found = await walkFolder(folder);
  // A hard link in an extracted archive can alias a file outside the template.
  const linked = found.find((file) => file.nlink > 1);
  if (linked !== undefined) { throw new Error(`"${linked.path}" is a hard link`); }
  const problem = deriveTemplateTreeProblem(found);
  if (problem !== undefined) { throw new Error(problem); }
  return Promise.all(found.map(async (file) => ({ path: file.path, bytes: new Uint8Array(await fs.promises.readFile(file.absolute)) })));
}

// Per-device and per-draft state that a new project must not inherit.
const EXCLUDED_PATHS = new Set([
  PROJECT_FILE, ".labshelf/versions", ".labshelf/rebuttal", ".labshelf/comments.json", ".labshelf/state.json", ".labshelf/checklist.json",
  ".labshelf/mirror-lease.json",
]);

// Both builds copy the PDF next to each root source file, so a PDF with a same-named source beside it is build output.
function withoutBuiltPdfs(files: FoundFile[]): FoundFile[] {
  const paths = new Set(files.map((f) => f.path));
  return files.filter(({ path: p }) => {
    if (!p.endsWith(".pdf")) { return true; }
    const base = p.slice(0, -".pdf".length);
    return !paths.has(`${base}.tex`) && !paths.has(`${base}.typ`);
  });
}

/** The kept files of the project folder; `.git` is skipped, and a symbolic link or special file throws naming its path. */
export async function listProjectFiles(folder: string): Promise<FoundFile[]> {
  return withoutBuiltPdfs(await walkFolder(folder, (rel, name) => name === ".git" || EXCLUDED_PATHS.has(rel)));
}
