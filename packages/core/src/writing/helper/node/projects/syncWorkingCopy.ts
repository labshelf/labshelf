// Brings a project's TeX working copy up to date with the project's files and unsaved text.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { MAX_PROJECT_BYTES } from "../../index.js";
import { HelperProjectError } from "./helperProjectError.js";
import { listProjectFiles } from "./listProjectFiles.js";
import type { OpenProject } from "./projectState.js";

async function io<T>(action: string, file: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new HelperProjectError("io", `Could not ${action} "${file}" for the working copy`, { cause: error });
  }
}

/** Writes only into `srcDir`, never into the library; an unchanged file is not touched so latexmk reruns only what changed. */
export async function syncWorkingCopy(project: OpenProject, srcDir: string): Promise<void> {
  const present = new Set<string>();
  let totalBytes = 0;
  const addBytes = (bytes: number) => {
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_BYTES) { throw new HelperProjectError("limit", `The project is larger than ${MAX_PROJECT_BYTES / (1024 * 1024)} MiB`); }
  };
  for (const file of await listProjectFiles(project.root)) {
    if (project.unsaved.has(file)) { continue; }
    present.add(file);
    const from = path.join(project.root, file);
    const to = path.join(srcDir, file);
    const { size, mtimeMs } = await io("read", from, () => fs.stat(from));
    addBytes(size);
    const signature = `file:${size}:${mtimeMs}`;
    if (project.synced.get(file) === signature) { continue; }
    await io("copy", from, async () => {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    });
    project.synced.set(file, signature);
  }
  for (const [file, { text, version }] of project.unsaved) {
    present.add(file);
    addBytes(Buffer.byteLength(text));
    const signature = `text:${version}`;
    if (project.synced.get(file) === signature) { continue; }
    const to = path.join(srcDir, file);
    await io("write", to, async () => {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, text);
    });
    project.synced.set(file, signature);
  }
  for (const [file] of [...project.synced]) {
    if (present.has(file)) { continue; }
    await io("remove", file, () => fs.rm(path.join(srcDir, file), { force: true }));
    project.synced.delete(file);
  }
}
