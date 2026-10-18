/** Activates the extension in a web extension host: the web composition root, which reaches no Node API. */
import type * as vscode from "vscode";

import { activateExtension } from "./activation/index.js";
import { createWebPlatform } from "./activation/web/index.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateExtension(context, createWebPlatform(context));
}

export function deactivate(): void { return; }
