// Builds the web platform: web adapters, LaTeX through LabShelf Helper, and the library folder from the editor page or the open dialog.
import type * as vscode from "vscode";

import { chooseLibraryFolder } from "../../library/index.js";
import { registerWebWriting } from "../../writing/web/index.js";
import type { ExtensionPlatform } from "../extensionPlatform.js";
import { createOutputChannelLogger } from "./outputChannelLogger.js";
import { hostPageLibraryFolder } from "./hostPageLibraryFolder.js";
import { createWebAdapters } from "./webAdapters.js";

export function createWebPlatform(context: vscode.ExtensionContext): ExtensionPlatform {
  const logger = createOutputChannelLogger(context);
  const adapters = createWebAdapters(context, logger);
  void logger.log("INFO", "activation", "Web build: PDF reading, OCR, the AI index, conflict copies and Node builds are not available");
  return {
    adapters,
    registerWriting: registerWebWriting,
    chooseLibraryRoot: async () =>
      (await hostPageLibraryFolder(logger)) ?? chooseLibraryFolder({ sharedLibraryConfig: adapters.sharedLibraryConfig, logger }),
  };
}
