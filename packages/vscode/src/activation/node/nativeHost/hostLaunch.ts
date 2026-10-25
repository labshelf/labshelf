// Describes how the browser starts a host script bundled in this extension.
import * as path from "node:path";
import type * as vscode from "vscode";

import type { ScriptEntry } from "@labshelf/core/nativeHost/node";

/** The two host scripts the extension bundles into out/. */
export type BundledHost = "bridgeHost" | "helperHost";

export function createScriptLaunch(context: Pick<vscode.ExtensionContext, "extensionPath">, host: BundledHost): ScriptEntry {
  // PLATFORM: the extension host is an Electron binary, which acts as Node only with ELECTRON_RUN_AS_NODE=1.
  return { kind: "script", owner: "vscode", nodePath: process.execPath, hostScript: path.join(context.extensionPath, "out", `${host}.js`), electronRunAsNode: true };
}
