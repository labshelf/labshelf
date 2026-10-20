// Reads a mirrored file, optionally only once two reads a moment apart agree, so a half-written file is never taken.
import { promises as fs } from "node:fs";
import type { DiskRead } from "../../mirror/index.js";

interface Sample { size: number; mtimeMs: number; bytes: Uint8Array }

async function sample(file: string): Promise<Sample | undefined> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) { return undefined; }
    return { size: stat.size, mtimeMs: stat.mtimeMs, bytes: new Uint8Array(await fs.readFile(file)) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") { return undefined; }
    throw error;
  }
}

const same = (a: Sample | undefined, b: Sample | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.size === b.size && a.mtimeMs === b.mtimeMs && Buffer.from(a.bytes).equals(Buffer.from(b.bytes));

/** One read when `settleMs` is undefined; otherwise `changing` unless size, mtime and bytes agree `settleMs` later. */
export async function readDisk(file: string, settleMs?: number): Promise<DiskRead> {
  const first = await sample(file);
  if (settleMs !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    if (!same(first, await sample(file))) { return { state: "changing" }; }
  }
  return first ? { state: "present", bytes: first.bytes } : { state: "missing" };
}
