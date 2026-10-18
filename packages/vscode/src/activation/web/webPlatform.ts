// Builds the web platform: web adapters, LaTeX through LabShelf Helper, and a library folder chosen with the open dialog.
import type * as vscode from "vscode";

import { chooseLibraryFolder } from "../../library/index.js";
import { registerWebWriting } from "../../writing/web/index.js";
import type { ExtensionPlatform } from "../extensionPlatform.js";
import { createOutputChannelLogger } from "./outputChannelLogger.js";
import { createWebAdapters } from "./webAdapters.js";

export function createWebPlatform(context: vscode.ExtensionContext): ExtensionPlatform {
  const logger = createOutputChannelLogger(context);
  const adapters = createWebAdapters(context, logger);
  void logger.log("INFO", "activation", "Web build: PDF reading, OCR, the AI index, conflict copies and Node builds are not available");
  return {
    adapters,
    registerWriting: registerWebWriting,
    chooseLibraryRoot: () => chooseLibraryFolder({ sharedLibraryConfig: adapters.sharedLibraryConfig, logger }),
  };
}
