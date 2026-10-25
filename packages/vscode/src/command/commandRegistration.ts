// Orchestrates registration of every labshelf.* command by calling each thematic group in turn.
import * as vscode from "vscode";

import { registerImportCommands } from "./importCommands.js";
import { registerMaintenanceCommands } from "./libraryMaintenanceCommands.js";
import { registerMetadataCommands } from "./paperMetadataCommands.js";
import { registerPaperOpenCommands } from "./paperOpenCommands.js";
import { registerTextLayerCommands } from "./textLayerCommands.js";
import type { RequireServices } from "./commandContext.js";

/** Registers all labshelf.* commands onto the extension context subscriptions */
export function registerCommands(
  context: vscode.ExtensionContext,
  requireServices: RequireServices,
): void {
  registerImportCommands(context, requireServices);
  registerTextLayerCommands(context, requireServices);
  registerPaperOpenCommands(context, requireServices);
  registerMaintenanceCommands(context, requireServices);
  registerMetadataCommands(context, requireServices);
}
