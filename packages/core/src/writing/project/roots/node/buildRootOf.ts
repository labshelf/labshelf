/** Decides which project root a save of a source file builds: the file itself when it is a root, else the main file. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listProjectFiles } from "../../folder/index.js";
import { nodeFileReads } from "../../node/index.js";
import { findRoots } from "../rootDetection.js";

const SOURCE_EXTENSION = /\.(tex|typ)$/i;

async function readSource(absolute: string, relative: string): Promise<{ path: string; text: string } | undefined> {
  try {
    return { path: relative, text: await fs.readFile(absolute, "utf8") };
  } catch {
    return undefined; // an unreadable file cannot be a root
  }
}

/** Project-relative posix root a save of `file` (absolute) builds. */
export async function buildRootOf(projectFolder: string, main: string, file: string): Promise<string> {
  const relative = path.relative(projectFolder, file).split(path.sep).join("/");
  if (relative.startsWith("..") || path.isAbsolute(relative) || !SOURCE_EXTENSION.test(relative)) { return main; }
  const relatives = (await listProjectFiles(nodeFileReads, projectFolder)).filter((candidate) => SOURCE_EXTENSION.test(candidate));
  const sources = await Promise.all(relatives.map((candidate) => readSource(path.join(projectFolder, candidate), candidate)));
  const roots = findRoots(sources.filter((source) => source !== undefined));
  return roots.includes(relative) ? relative : main;
}
