// Builds the desktop platform: Node adapters, the Node Writing registrations, the library flows over the user's disk and the sharing host.
import * as vscode from "vscode";

import { registerCollaboration } from "../../collab/node/index.js";
import { chooseLibraryRoot, offerLibraryMove, runMoveLibraryCommand } from "../../library/node/index.js";
import { registerShareLinks } from "../../share/node/index.js";
import { sharingWebviews } from "../../sharing/index.js";
import { createVscodeSharingHost, serveSharingOn } from "../../sharing/node/index.js";
import { registerNodeWriting } from "../../writing/node/index.js";
import type { ExtensionPlatform } from "../extensionPlatform.js";
import { createNodeAdapters } from "./nodeAdapters.js";
import { registerNativeHostCommands } from "./nativeHost/index.js";

export function createDesktopPlatform(context: vscode.ExtensionContext): ExtensionPlatform {
  const adapters = createNodeAdapters(context);
  return {
    adapters,
    registerWriting: registerNodeWriting,
    chooseLibraryRoot: () => chooseLibraryRoot(adapters),
    afterSavedLibraryOpened: offerLibraryMove,
    registerPlatformCommands: (extensionContext, controller, projects) => {
      extensionContext.subscriptions.push(vscode.commands.registerCommand("labshelf.moveLibrary", () => runMoveLibraryCommand(controller)));
      registerNativeHostCommands(extensionContext, adapters);
      const collab = registerCollaboration(extensionContext, controller, projects);
      registerShareLinks(extensionContext, controller);
      const sharing = createVscodeSharingHost(controller, collab, collab.logger);
      extensionContext.subscriptions.push(sharingWebviews.serve((webview) => serveSharingOn(webview, sharing, collab.logger)));
    },
  };
}
