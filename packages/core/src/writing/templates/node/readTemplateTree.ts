/** Reads every file of a template folder from disk after checking the whole tree against the path rules. */
// CONTRACT: documents/contracts/templates.md#paths

import * as fs from "node:fs";
import * as path from "node:path";

import { templateTreeProblem } from "../templatePaths.js";
import type { TemplateFile } from "../sources/index.js";

interface FoundFile {
  path: string;
  absolute: string;
  size: number;
}

// TRAP: tar extracts symlinks, so this lstat walk is the only guard between an archive and the files it points at.
async function walk(root: string, relative: string, found: FoundFile[]): Promise<void> {
  const directory = relative === "" ? root : path.join(root, ...relative.split("/"));
  for (const name of await fs.promises.readdir(directory)) {
    const rel = relative === "" ? name : `${relative}/${name}`;
    const absolute = path.join(directory, name);
    const stat = await fs.promises.lstat(absolute);
    if (stat.isSymbolicLink()) { throw new Error(`"${rel}" is a symbolic link`); }
    if (stat.isDirectory()) { await walk(root, rel, found); continue; }
    if (!stat.isFile()) { throw new Error(`"${rel}" is not a regular file`); }
    if (stat.nlink > 1) { throw new Error(`"${rel}" is a hard link`); }
    found.push({ path: rel, absolute, size: stat.size });
  }
}

/** The folder's files sorted by their `/`-joined relative path; throws naming the path of the first one that breaks a rule. */
export async function readTemplateTree(folder: string): Promise<TemplateFile[]> {
  const root = await fs.promises.lstat(folder);
  if (!root.isDirectory()) { throw new Error(`${folder} is not a folder`); }
  const found: FoundFile[] = [];
  await walk(folder, "", found);
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const problem = templateTreeProblem(found);
  if (problem !== undefined) { throw new Error(problem); }
  return Promise.all(found.map(async (file) => ({ path: file.path, bytes: new Uint8Array(await fs.promises.readFile(file.absolute)) })));
}
