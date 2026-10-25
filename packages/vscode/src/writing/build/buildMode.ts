// Reads the auto compile mode and tells the build listeners whether a save or an edit may start a build.
import * as vscode from "vscode";

import { AUTO_COMPILE_MODES, type AutoCompileMode, type ILogger } from "@labshelf/core";

const SECTION = "labshelf.writing";
const KEY = "autoCompile";
const MODULE = "AutoCompile";
const DEFAULT_MODE: AutoCompileMode = "typing";

/** Configuration is untrusted input: an unknown value reads as the default mode. */
export function readAutoCompileMode(): AutoCompileMode {
  const value = vscode.workspace.getConfiguration(SECTION).get<unknown>(KEY, DEFAULT_MODE);
  return AUTO_COMPILE_MODES.find((mode) => mode === value) ?? DEFAULT_MODE;
}

export function onAutoCompileChange(fn: (mode: AutoCompileMode) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SECTION}.${KEY}`)) { fn(readAutoCompileMode()); }
  });
}

/** What started the build: "typing" is an edit, "save" is a save or opening the project. */
export type AutoCompileTrigger = "typing" | "save";

/** Decides per save or edit whether a build may start; when it may not it logs the skip once until the setting changes. */
export function createAutoCompileGate(logger: () => ILogger | undefined): vscode.Disposable & { allows(trigger: AutoCompileTrigger): boolean } {
  let logged = false;
  const subscription = onAutoCompileChange(() => { logged = false; });
  return {
    allows(trigger): boolean {
      const mode = readAutoCompileMode();
      if (mode === "typing" || (mode === "save" && trigger === "save")) { return true; }
      if (!logged) {
        logged = true;
        void logger()?.log("INFO", MODULE, `Auto compile is ${mode}: ${trigger === "typing" ? "edits" : "saves and edits"} start no build; use Build Project or Recompile.`);
      }
      return false;
    },
    dispose: () => subscription.dispose(),
  };
}
