// Registers the desktop commands that share a library folder as a link, manage those links and import a share link, each opening its sharing dialog.
import * as vscode from "vscode";

import type { ShareDialogRequest, ShareHost } from "@labshelf/core";
import type { LibraryRootController } from "../../activation/index.js";
import type { ActiveServices } from "../../command/index.js";
import { createLibraryPaths } from "../../libraryUi/index.js";
import { findDeckLink, runInsertQr, runShareDeck } from "./shareDeck.js";
import { IMPORT_SHARE_COMMAND, SHARE_FOLDER_COMMAND, sharingWebviews } from "../webviews.js";

const MANAGE_SHARES_COMMAND = "labshelf.share.manage";
const SHARE_DECK_COMMAND = "labshelf.decks.shareLink";
const INSERT_QR_COMMAND = "labshelf.decks.insertQr";

type Controller = Pick<LibraryRootController, "require">;

/** A Library view node names its folder; the papers root, anything outside it or no node means the user picks one. */
function folderRequest(target: unknown, { mutations }: ActiveServices): ShareDialogRequest {
  const dir = typeof target === "object" && target !== null && "dirPath" in target ? (target as { dirPath: unknown }).dirPath : undefined;
  if (typeof dir !== "string" || dir === mutations.papersRoot) { return { kind: "shareFolder" }; }
  const path = createLibraryPaths(mutations.papersRoot, mutations.paths).toUi(dir);
  return path === null ? { kind: "shareFolder" } : { kind: "shareFolder", path };
}

/** The deck of the given uri, else of the active tab. */
function deckTarget(uri: unknown): vscode.Uri | undefined {
  if (uri instanceof vscode.Uri) { return uri; }
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input && typeof input === "object" && "uri" in input && input.uri instanceof vscode.Uri ? input.uri : undefined;
}

/** Share Deck as Link and Insert QR Code, which run over the desktop sharing host. */
function registerDeckShare(context: vscode.ExtensionContext, sharing: ShareHost): void {
  const ui = {
    copyText: (text: string) => sharing.copyText(text),
    info: (message: string, ...actions: string[]) => vscode.window.showInformationMessage(message, ...actions),
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(SHARE_DECK_COMMAND, async (uri?: unknown) => {
      const deck = deckTarget(uri);
      if (deck) { await runShareDeck(deck, sharing, ui); }
    }),
    // The slide is the editor's current one; the command palette gives none, so the first.
    vscode.commands.registerCommand(INSERT_QR_COMMAND, async (uri?: unknown, slide?: unknown) => {
      const deck = deckTarget(uri);
      const link = deck ? await findDeckLink(deck, sharing) : undefined;
      if (deck && link) { await runInsertQr(deck, link, typeof slide === "number" ? slide : 0); }
    }),
  );
}

export function registerShareLinks(context: vscode.ExtensionContext, controller: Controller, sharing?: ShareHost): void {
  if (sharing) { registerDeckShare(context, sharing); }
  const open = async (request: (services: ActiveServices) => ShareDialogRequest): Promise<void> => {
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
