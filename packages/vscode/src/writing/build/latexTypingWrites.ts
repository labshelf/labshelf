// Saves a LaTeX source shortly after typing stops, so the save trigger compiles it, while auto compile is in typing mode.
import { AUTO_SAVE_DELAY_MS } from "@labshelf/core";
import * as vscode from "vscode";

import { findOwningProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import { createAutoCompileGate } from "./buildMode.js";

const MODULE = "writing/build";

export interface LatexTypingWritesDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
}

function isLatexSource(projects: LatexTypingWritesDeps["projects"], file: vscode.Uri): boolean {
  if (file.scheme !== "file") { return false; }
  return findOwningProject(projects, file.fsPath)?.settings.format === "latex";
}

export function registerLatexTypingWrites(deps: LatexTypingWritesDeps): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const autoCompile = createAutoCompileGate(() => deps.host.current()?.logger);

  const saveIfDirty = async (document: vscode.TextDocument): Promise<void> => {
    if (!document.isDirty) { return; }
    try {
      await document.save();
    } catch (error) {
      await deps.host.current()?.logger.error(MODULE, error, { file: document.uri.fsPath, action: "save after typing" });
    }
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const { document } = event;
      if (event.contentChanges.length === 0 || !isLatexSource(deps.projects, document.uri) || !autoCompile.allows("typing")) { return; }
      const key = document.uri.fsPath;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        void saveIfDirty(document);
      }, AUTO_SAVE_DELAY_MS));
    }),
    autoCompile,
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  );
}
