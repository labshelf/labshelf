/** Activates the desktop extension: the Node composition root. */
import type * as vscode from "vscode";

import { startExtension } from "./activation/index.js";
import { createDesktopPlatform } from "./activation/node/index.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await startExtension(context, createDesktopPlatform(context));
}

/** Called by VS Code on extension deactivation — cleanup is handled via disposables */
export function deactivate(): void { return; }
