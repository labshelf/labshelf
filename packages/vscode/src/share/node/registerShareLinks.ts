// Registers the desktop commands that share a library folder as a link, manage those links and import a share link, each opening its sharing dialog.
import * as vscode from "vscode";

import type { SharingDialogRequest } from "@labshelf/core";
import type { LibraryRootController } from "../../activation/libraryLifecycle/index.js";
import type { ActiveServices } from "../../commands/index.js";
import { sharingWebviews } from "../../sharing/index.js";
import { libraryPaths } from "../../ui/list/index.js";
import { IMPORT_SHARE_COMMAND, SHARE_FOLDER_COMMAND } from "../shareCommandIds.js";

const MANAGE_SHARES_COMMAND = "labshelf.share.manage";

type Controller = Pick<LibraryRootController, "require">;

/** A Library view node names its folder; the papers root, anything outside it or no node means the user picks one. */
function folderRequest(target: unknown, { mutations }: ActiveServices): SharingDialogRequest {
  const dir = typeof target === "object" && target !== null && "dirPath" in target ? (target as { dirPath: unknown }).dirPath : undefined;
  if (typeof dir !== "string" || dir === mutations.papersRoot) { return { kind: "shareFolder" }; }
  const path = libraryPaths(mutations.papersRoot, mutations.paths).toUi(dir);
  return path === null ? { kind: "shareFolder" } : { kind: "shareFolder", path };
}

export function registerShareLinks(context: vscode.ExtensionContext, controller: Controller): void {
  const open = async (request: (services: ActiveServices) => SharingDialogRequest): Promise<void> => {
    const services = await controller.require();
    if (services) { await sharingWebviews.open(request(services)); }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(SHARE_FOLDER_COMMAND, (target?: unknown) => open((services) => folderRequest(target, services))),
    vscode.commands.registerCommand(MANAGE_SHARES_COMMAND, () => open(() => ({ kind: "manageLinks" }))),
    vscode.commands.registerCommand(IMPORT_SHARE_COMMAND, (link?: unknown) =>
      open(() => (typeof link === "string" ? { kind: "importLink", link } : { kind: "importLink" }))),
  );
}
