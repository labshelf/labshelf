// Moves a library folder to a new location without losing a file, and records the new root in the shared config.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { errorMessage } from "../../../logging/index.js";
import { libraryKey } from "../deviceState/index.js";
import { sharedConfigPath, updateSharedConfig } from "../sharedConfigFile.js";
import { assertMovable } from "./assertMovable.js";
import { copyTreeVerified } from "./copyTreeVerified.js";
import { moveDeviceLocalFolders } from "./moveDeviceLocalFolders.js";

export interface MoveLibraryOptions {
  logger: ILogger;
  env: NodeJS.ProcessEnv;
  /** Called after each copied file; only a move across devices copies. */
  onProgress?: ((copied: number, total: number) => void) | undefined;
}

// PLATFORM: rename fails with EXDEV between volumes, which is the only case that needs a copy.
async function renameOrCopy(source: string, target: string, options: MoveLibraryOptions): Promise<void> {
  const { logger } = options;
  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") { throw error; }
  }
  await logger.log("INFO", "libraryMove", "Library is on another volume, copying and verifying", { from: source, to: target });
  try {
    await copyTreeVerified(source, target, options.onProgress);
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch((cleanup) => logger.error("libraryMove", cleanup, { target }));
    throw error;
  }
  // The copy is verified, so a source that cannot be fully deleted is leftover, not lost data.
  await fs.rm(source, { recursive: true, force: true }).catch((cleanup) =>
    logger.error("libraryMove", cleanup, { action: "delete source after verified copy", source }));
}

async function relocate(source: string, target: string, options: MoveLibraryOptions): Promise<void> {
  // INVARIANT: assertMovable has shown the target holds no file, so removing it removes only empty folders.
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await renameOrCopy(source, target, options);
}

/**
 * Moves the library and its device-local folders, then points the shared config at the new root.
 * @throws before touching anything when the move is refused (see assertMovable); after a failed copy the source
 * is intact and the partial target is gone
 */
export async function moveLibrary(from: string, to: string, options: MoveLibraryOptions): Promise<void> {
  const { logger, env } = options;
  const source = path.resolve(from);
  const target = path.resolve(to);
  await logger.log("INFO", "libraryMove", "Moving library", { from: source, to: target });
  let fromKey: string;
  try {
    await assertMovable(source, target);
    fromKey = libraryKey(source);
    await relocate(source, target, options);
  } catch (error) {
    await logger.error("libraryMove", error, { action: "move library", from: source, to: target });
    throw new Error(`Could not move the library from ${source} to ${target}: ${errorMessage(error)}`, { cause: error });
  }
  await moveDeviceLocalFolders(fromKey, libraryKey(target), env, logger);
  await updateSharedConfig({ libraryRoot: target }, sharedConfigPath(env), logger);
  await logger.log("INFO", "libraryMove", "Library moved", { from: source, to: target });
}
