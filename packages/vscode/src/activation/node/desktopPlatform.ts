// Builds the desktop platform: Node adapters, the Node Writing registrations and the library flows over the user's disk.
import * as vscode from "vscode";

import { registerCollaboration } from "../../collab/node/index.js";
import { chooseLibraryRoot, offerLibraryMove, runMoveLibraryCommand } from "../../library/node/index.js";
import { registerShareLinks } from "../../share/node/index.js";
import { registerNodeWriting } from "../../writing/node/index.js";
import type { ExtensionPlatform } from "../extensionPlatform.js";
import { createNodeAdapters } from "./nodeAdapters.js";
import { registerBridgeCommand } from "./registerBridgeCommand.js";

export function createDesktopPlatform(context: vscode.ExtensionContext): ExtensionPlatform {
  const adapters = createNodeAdapters(context);
  return {
    adapters,
    registerWriting: registerNodeWriting,
    chooseLibraryRoot: () => chooseLibraryRoot(adapters),
    afterSavedLibraryOpened: offerLibraryMove,
    registerPlatformCommands: (extensionContext, controller, projects) => {
      extensionContext.subscriptions.push(vscode.commands.registerCommand("labshelf.moveLibrary", () => runMoveLibraryCommand(controller)));
      registerBridgeCommand(extensionContext, adapters);
      registerCollaboration(extensionContext, controller, projects);
      registerShareLinks(extensionContext, controller);
    },
  };
}
