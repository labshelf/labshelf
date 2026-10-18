// Stores the library root in VS Code's global state, for hosts without the config file shared with the terminal app (the web build).
import type * as vscode from "vscode";

import type { SharedLibraryConfig } from "./sharedLibraryConfig.js";

const LIBRARY_FOLDER_KEY = "labshelf.libraryFolder";

export function globalStateLibraryConfig(state: vscode.Memento): SharedLibraryConfig {
  return {
    readRoot: async () => state.get<string>(LIBRARY_FOLDER_KEY),
    recordRoot: async (root) => { await state.update(LIBRARY_FOLDER_KEY, root); },
    path: () => `globalState:${LIBRARY_FOLDER_KEY}`,
  };
}
