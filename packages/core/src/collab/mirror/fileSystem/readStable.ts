// Reads a mirror file once, or twice a settle interval apart so a file still being written reads as changing.
import { sleep } from "../../../async/index.js";
import { sameBytes } from "../../../encoding/index.js";
import type { MirrorFileRead } from "./mirrorFileSystem.js";

/** What one look at a file shows: enough to tell that it changed between two looks. */
export interface MirrorSample { size: number; mtimeMs: number; bytes: Uint8Array }

const agree = (a: MirrorSample | undefined, b: MirrorSample | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.size === b.size && a.mtimeMs === b.mtimeMs && sameBytes(a.bytes, b.bytes);

/** One sample when `settleMs` is undefined; otherwise `changing` unless size, mtime and bytes agree `settleMs` later. */
export async function readStable(sample: () => Promise<MirrorSample | undefined>, settleMs?: number): Promise<MirrorFileRead> {
  const first = await sample();
  if (settleMs !== undefined) {
    await sleep(settleMs);
    if (!agree(first, await sample())) { return { state: "changing" }; }
  }
  return first ? { state: "present", bytes: first.bytes } : { state: "missing" };
}
