// Implements the shared library config over the config file in the user's config folder.
import { readSharedLibraryRoot, resolveSharedConfigPath, updateSharedConfig } from "@labshelf/core/node";
import type { SharedLibraryConfig } from "../paths/index.js";

export const nodeSharedLibraryConfig: SharedLibraryConfig = {
  readRoot: () => readSharedLibraryRoot(),
  recordRoot: async (root, logger) => { await updateSharedConfig({ libraryRoot: root }, undefined, logger); },
  path: () => resolveSharedConfigPath(),
};
