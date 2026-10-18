// Implements ILatexHelper by forwarding each call to the command the web editor page registers for LabShelf Helper.
// CONTRACT: documents/contracts/editor-host.md#latex-helper
import * as vscode from "vscode";

import { compileResultFromWire, projectToWire, type HelperStatus, type ILatexHelper } from "@labshelf/core/helper";

/** The page command that runs one helper method: `(method, ...args)`. */
export const LATEX_HELPER_COMMAND = "labshelf.editorHost.latexHelper";
// CONTRACT: documents/contracts/editor-host.md#helper-setup
/** The page command that shows the helper setup card. */
export const SHOW_HELPER_SETUP_COMMAND = "labshelf.editorHost.showHelperSetup";

type HelperMethod = "connect" | "compile" | "cancel" | "installTex" | "installAllPackages";

async function call<T>(method: HelperMethod, ...args: unknown[]): Promise<T> {
  return await vscode.commands.executeCommand<T>(LATEX_HELPER_COMMAND, method, ...args);
}

/** A missing page command rejects every call, which callers treat as a helper that is not ready. */
export function createHostPageLatexHelper(): ILatexHelper {
  let last: HelperStatus | undefined;
  // TRAP: command arguments and results are serialized between the extension host and the page, so progress callbacks
  // cannot cross (the page shows build and install progress itself) and bytes cross as base64.
  return {
    connect: async () => (last = await call<HelperStatus>("connect")),
    status: () => last,
    compile: async (project) => compileResultFromWire(await call<unknown>("compile", projectToWire(project))),
    cancel: async (projectId) => { await call("cancel", projectId); },
    installTex: async (kind) => { await call("installTex", kind); },
    installAllPackages: async () => { await call("installAllPackages"); },
  };
}
