// Reports saved and edited files of the workspace as source changes.
import * as vscode from "vscode";

import type { SourceEvents } from "./staleSources.js";
import { disposeAll } from "../../disposables/index.js";

export const vscodeSourceEvents: SourceEvents = {
  onSourceChanged(listener) {
    const subscriptions = [
      vscode.workspace.onDidSaveTextDocument((document) => { if (document.uri.scheme === "file") { listener(document.uri.fsPath); } }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme === "file" && event.contentChanges.length > 0) { listener(event.document.uri.fsPath); }
      }),
    ];
    return { dispose: () => disposeAll(subscriptions) };
  },
};
