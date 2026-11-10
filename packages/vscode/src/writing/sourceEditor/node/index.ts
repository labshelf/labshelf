// Exports the Node-only part of the LabShelf editor: the machine-local spelling dictionaries and the Style panel's preview compiler the desktop platform builds.
import * as vscode from "vscode";

import type { DictionaryStore, ILogger } from "@labshelf/core";

export { createStylePreviewHandler } from "./deckStylePreview.js";
import { NodeDictionaryStore } from "./dictionaryStore.js";

/** Bundled dictionaries ship in the extension; downloaded ones and the user's words stay on this machine. */
export function createNodeDictionaryStore(context: vscode.ExtensionContext, logger: ILogger): DictionaryStore {
  return new NodeDictionaryStore({
    bundledDir: vscode.Uri.joinPath(context.extensionUri, "dist", "dictionaries").fsPath,
    storageDir: vscode.Uri.joinPath(context.globalStorageUri, "dictionaries").fsPath,
    fetchFn: (url) => fetch(url), logger,
  });
}
