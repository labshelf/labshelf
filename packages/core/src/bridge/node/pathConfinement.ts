/** Resolves a bridge path under the library root and refuses any path that leaves it. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BridgeError } from "../bridgeError.js";

type PathApi = Pick<typeof path, "relative" | "isAbsolute" | "sep">;

const errnoCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;
const outside = (relative: string): BridgeError =>
  new BridgeError("outsideLibrary", `Path "${relative}" is outside the library`);
// The library is shared across OSes, so a name Windows cannot hold is refused everywhere.
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(?:\..*)?$/i;

/** Whether `real` is `base` or below it; win32 compares case-insensitively and across drives. */
export function isInsideRoot(base: string, real: string, api: PathApi = path): boolean {
  const relative = api.relative(base, real);
  return relative === "" || (!api.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${api.sep}`));
}

/** The real path of the target, or of its nearest existing ancestor with the missing tail appended. */
async function realPathOrAncestor(target: string, relative: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }
  // A dangling symlink resolves nowhere, and a write through it would create its target wherever it points.
  if (await fs.lstat(target).then((s) => s.isSymbolicLink(), () => false)) throw outside(relative);
  const parent = path.dirname(target);
  return path.join(await realPathOrAncestor(parent, relative), path.basename(target));
}

async function realRootOf(root: string): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch (error) {
    throw new BridgeError("noLibrary", `Library folder "${root}" is not reachable (${errnoCode(error) ?? String(error)})`);
  }
}

/** The path's segments; throws outsideLibrary for any shape that could leave the root. */
function segmentsOf(relative: string): string[] {
  if (relative.includes("\0") || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
    throw outside(relative);
  }
  const segments = relative.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === ".." || WINDOWS_DEVICE_NAME.test(segment))) throw outside(relative);
  return segments;
}

/** Throws outsideLibrary unless the real path of `dir` (or of its nearest existing ancestor) is under `realRoot`. */
export async function assertInLibrary(realRoot: string, dir: string): Promise<void> {
  if (!isInsideRoot(realRoot, await realPathOrAncestor(dir, dir))) throw outside(dir);
}

// CONTRACT: documents/contracts/bridge.md#paths
/** @returns the absolute path under the real library root; throws outsideLibrary or noLibrary */
export async function resolveInLibrary(root: string, relative: string): Promise<string> {
  const segments = segmentsOf(relative);
  const base = await realRootOf(root);
  const target = path.join(base, ...segments);
  if (!isInsideRoot(base, await realPathOrAncestor(target, relative))) throw outside(relative);
  return target;
}

export interface LibraryParent {
  realRoot: string;
  /** Real path of the entry's folder, which may not exist yet. */
  realParent: string;
  /** The entry's own name; `""` for the root itself. */
  name: string;
}

// CONTRACT: documents/contracts/bridge.md#paths
/** Confines the entry's folder, not the entry, so a symlink entry can be inspected or removed itself. */
export async function resolveParentInLibrary(root: string, relative: string): Promise<LibraryParent> {
  const segments = segmentsOf(relative);
  const realRoot = await realRootOf(root);
  const name = segments.pop();
  if (name === undefined) return { realRoot, realParent: realRoot, name: "" };
  const realParent = await realPathOrAncestor(path.join(realRoot, ...segments), relative);
  if (!isInsideRoot(realRoot, realParent)) throw outside(relative);
  return { realRoot, realParent, name };
}
