// Copies a project's files into the history's content-addressed store and returns the snapshot's path → hash map.
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listProjectFiles } from "../../project/node/index.js";
import { HISTORY_OBJECTS } from "../historyLayout.js";

/** Larger files, such as datasets or videos, would make every snapshot slow and the store large. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUILT_SIBLINGS = [".tex", ".typ"];

export function objectPath(historyDir: string, hash: string): string {
  return path.join(historyDir, HISTORY_OBJECTS, hash.slice(0, 2), hash);
}

// A PDF next to a source of the same name is the build's copy of its output, which every save rewrites.
function isBuiltPdf(file: string, all: ReadonlySet<string>): boolean {
  if (path.extname(file).toLowerCase() !== ".pdf") { return false; }
  const stem = file.slice(0, -4);
  return BUILT_SIBLINGS.some((ext) => all.has(stem + ext));
}

async function storeObject(historyDir: string, hash: string, content: Buffer): Promise<void> {
  const target = objectPath(historyDir, hash);
  if (await fs.access(target).then(() => true, () => false)) { return; }
  await fs.mkdir(path.dirname(target), { recursive: true });
  // INVARIANT: an object is written whole under a temp name first, so a crash never leaves a truncated object under its hash.
  const temp = `${target}.tmp-${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, content);
  await fs.rename(temp, target);
}

/** @returns project-relative paths with "/" separators → SHA-256 */
export async function snapshotFiles(folder: string, historyDir: string): Promise<Record<string, string>> {
  const files = await listProjectFiles(folder);
  const all = new Set(files);
  const map: Record<string, string> = {};
  for (const file of files) {
    if (isBuiltPdf(file, all)) { continue; }
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE_BYTES) { continue; }
    const content = await fs.readFile(file);
    const hash = createHash("sha256").update(content).digest("hex");
    await storeObject(historyDir, hash, content);
    map[path.relative(folder, file).split(path.sep).join("/")] = hash;
  }
  return map;
}
