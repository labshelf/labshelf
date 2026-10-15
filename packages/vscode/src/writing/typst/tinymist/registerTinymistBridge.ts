// Connects LabShelf's Typst projects to the Tinymist extension: the install offer and the pinned main file.
import type * as vscode from "vscode";

import { registerTinymistOffer } from "./tinymistInstallOffer.js";
import { registerTinymistMainPin, type TinymistPinDeps } from "./tinymistMainPin.js";

export type TinymistBridgeDeps = Omit<TinymistPinDeps, "context">;

export function registerTinymistBridge(context: vscode.ExtensionContext, deps: TinymistBridgeDeps): void {
  registerTinymistOffer({ context, ...deps });
  registerTinymistMainPin({ context, ...deps });
}
