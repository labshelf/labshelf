// Moves a library root stored in VS Code globalState into the shared config, once per install.
// Delete when no supported VS Code build predates the shared config.
import type * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { SharedLibraryConfig } from "./paths/index.js";

const LIBRARY_ROOT_KEY = "labshelf.libraryRoot";
const MODULE = "storage";

/**
 * Copies a globalState-only root into the shared config, then clears the key. A root already in the shared config
 * wins. The key is cleared only after the shared config holds a root, so a failed write retries at the next start.
 * @param loggerFor builds the logger of the library the stored root points at
 * @returns the globalState root when the shared config could not take it, so this session still opens that library
 */
export async function migrateLibraryRootFromGlobalState(
  state: vscode.Memento,
  sharedConfig: SharedLibraryConfig,
  loggerFor: (root: string) => ILogger,
): Promise<string | undefined> {
  const stored = state.get<string>(LIBRARY_ROOT_KEY);
  if (!stored) { return undefined; }
  const logger = loggerFor(stored);
  const context = { file: sharedConfig.path(), globalStateRoot: stored };
  try {
    const sharedRoot = await sharedConfig.readRoot();
    if (sharedRoot === undefined) {
      await sharedConfig.recordRoot(stored, logger);
      await logger.log("INFO", MODULE, "Moved the library root into the shared config", { ...context, libraryRoot: stored });
    } else if (sharedRoot !== stored) {
      await logger.log("WARN", MODULE, "Kept the shared config's library root over a different globalState root", {
        ...context, sharedRoot,
      });
    }
    await state.update(LIBRARY_ROOT_KEY, undefined);
    return undefined;
  } catch (error) {
    await logger.error(MODULE, error, { ...context, action: "migrate library root", fallback: "open the globalState root this session" });
    return stored;
  }
}
