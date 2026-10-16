// Reads the auto compile setting and tells the build listeners whether a save or an edit may start a build.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";

const SECTION = "labshelf.writing";
const KEY = "autoCompile";
const MODULE = "AutoCompile";

export function autoCompileOn(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>(KEY, true);
}

export function onAutoCompileChange(fn: (on: boolean) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SECTION}.${KEY}`)) { fn(autoCompileOn()); }
  });
}

/** Decides per save or edit whether a build may start; with the setting off it logs the skip once until the setting changes. */
export function autoCompileGate(logger: () => ILogger | undefined): vscode.Disposable & { allows(): boolean } {
  let logged = false;
  const subscription = onAutoCompileChange(() => { logged = false; });
  return {
    allows(): boolean {
      if (autoCompileOn()) { return true; }
      if (!logged) {
        logged = true;
        void logger()?.log("INFO", MODULE, "Auto compile is off: saves and edits start no build; use Build Project or Recompile.");
      }
      return false;
    },
    dispose: () => subscription.dispose(),
  };
}
