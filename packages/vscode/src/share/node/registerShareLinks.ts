// Registers the desktop commands that share library folders as links, manage those links and import a share link's papers.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { LibraryRootController } from "../../activation/libraryLifecycle/index.js";
import { RelayAccounts } from "../../relay/index.js";
import { IMPORT_SHARE_COMMAND } from "../importShareCommandId.js";
import { importShare } from "./importShareCommand.js";
import { MANAGE_SHARES_COMMAND, manageShares } from "./manageSharesCommand.js";
import { SHARE_FOLDER_COMMAND, shareFolder } from "./shareFolderCommand.js";
import type { ShareLinkHost } from "./shareLinkHost.js";

type Controller = Pick<LibraryRootController, "currentRoot" | "currentServices" | "require">;

export function registerShareLinks(context: vscode.ExtensionContext, controller: Controller): void {
  const logger: ILogger = {
    log: async (...args) => { await controller.currentServices()?.logger.log(...args); },
    error: async (...args) => { await controller.currentServices()?.logger.error(...args); },
  };
  const host: ShareLinkHost = {
    requireServices: () => controller.require(),
    libraryRoot: () => controller.currentRoot()?.fsPath,
    relay: new RelayAccounts(context.secrets, logger),
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(SHARE_FOLDER_COMMAND, (target?: unknown) => shareFolder(host, target)),
    vscode.commands.registerCommand(MANAGE_SHARES_COMMAND, () => manageShares(host)),
    vscode.commands.registerCommand(IMPORT_SHARE_COMMAND, (link?: unknown) => importShare(host, link)),
  );
}
