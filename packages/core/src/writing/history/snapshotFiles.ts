// Copies a project's files into the history's content-addressed store and returns the snapshot's path → hash map.
import { listProjectFiles } from "../project/folder/index.js";
import type { HistoryTarget } from "./historyStorage.js";

/** Larger files, such as datasets or videos, would make every snapshot slow and the store large. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUILT_SIBLINGS = [".tex", ".typ"];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A PDF next to a source of the same name is the build's copy of its output, which every save rewrites.
function isBuiltPdf(file: string, all: ReadonlySet<string>): boolean {
  if (!file.toLowerCase().endsWith(".pdf")) { return false; }
  const stem = file.slice(0, -4);
  return BUILT_SIBLINGS.some((ext) => all.has(stem + ext));
}

/** @returns project-relative paths with "/" separators → SHA-256 */
export async function snapshotFiles({ project, folder, storage }: HistoryTarget): Promise<Record<string, string>> {
  const relatives = await listProjectFiles(project, folder);
  const all = new Set(relatives);
  const map: Record<string, string> = {};
  for (const relative of relatives) {
    if (isBuiltPdf(relative, all)) { continue; }
    const full = project.paths.join(folder, ...relative.split("/"));
    const stat = await project.fs.stat(full);
    if (!stat || stat.size > MAX_FILE_BYTES) { continue; }
    const content = await project.fs.readFile(full);
    const hash = await sha256Hex(content);
    if (!(await storage.hasObject(hash))) { await storage.writeObject(hash, content); }
    map[relative] = hash;
  }
  return map;
}
