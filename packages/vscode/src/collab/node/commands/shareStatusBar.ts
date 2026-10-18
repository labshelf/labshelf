// Shows the sharing state of the active project's share in the status bar, with the invite and leave actions on click.
import * as path from "node:path";
import * as vscode from "vscode";

import { projectName, type CollabHost } from "../collabHost.js";
import type { ShareConnection } from "../session/index.js";
import { copyInvite } from "./copyInvite.js";
import { LEAVE_COMMAND } from "./leaveCommand.js";

const MANAGE_COMMAND = "labshelf.collab.manage";
export const STATUS_COMMAND = "labshelf.collab.status";

/** The share of the active editor's file, else the first connected one. */
function currentShare(host: CollabHost): ShareConnection | undefined {
  const document = vscode.window.activeTextEditor?.document;
  const shares = host.shares.list();
  const inFolder = document?.uri.scheme === "file" ? shares.find((share) => document.uri.fsPath.startsWith(share.folder + path.sep)) : undefined;
  return (document && host.editors.of(document)?.share) ?? inFolder ?? shares[0];
}

function describe(share: ShareConnection): { text: string; tooltip: string } {
  const online = share.session.peers.length;
  if (share.session.status === "meshFull") {
    return { text: "$(broadcast) Shared · relay needed", tooltip: "Too many collaborators for direct connections; a relay is needed to connect more." };
  }
  if (share.session.status === "closed" || online === 0) {
    return { text: "$(broadcast) Shared · offline", tooltip: "No collaborator is connected. Edits sync when one opens the project." };
  }
  return { text: `$(broadcast) Shared · ${online} online`, tooltip: `${online} collaborator${online === 1 ? "" : "s"} connected.` };
}

async function manage(host: CollabHost): Promise<void> {
  const share = currentShare(host);
  if (!share) { return; }
  const project = host.projects.list().find((entry) => entry.kind === "ready" && entry.folder === share.folder);
  const name = project?.kind === "ready" ? projectName(project) : share.folder;
  const copy = { label: "$(link) Copy Invite Link", description: name };
  const leave = { label: "$(debug-disconnect) Stop Sharing on This Device", description: name };
  const picked = await vscode.window.showQuickPick([copy, leave], { placeHolder: `Shared project "${name}"` });
  if (picked === copy) {
    const stored = await host.keys.invite(share.shareId);
    if (stored) { await copyInvite(stored.link, name); }
  } else if (picked === leave) {
    await vscode.commands.executeCommand(LEAVE_COMMAND, share.folder);
  }
}

export function registerShareStatusBar(context: vscode.ExtensionContext, host: CollabHost): void {
  const item = vscode.window.createStatusBarItem("labshelf.collab", vscode.StatusBarAlignment.Left, 49);
  item.name = "LabShelf Sharing";
  item.command = MANAGE_COMMAND;
  const update = (): void => {
    const share = currentShare(host);
    if (!share) { item.hide(); return; }
    const { text, tooltip } = describe(share);
    item.text = text;
    item.tooltip = `${tooltip} Click to copy the invite link or stop sharing.`;
    item.show();
  };
  context.subscriptions.push(
    item,
    host.shares.onDidChange(update),
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.commands.registerCommand(MANAGE_COMMAND, () => manage(host)),
    // For scripts and end-to-end runs: the connected shares as plain data.
    vscode.commands.registerCommand(STATUS_COMMAND, () => host.shares.list().map((share) => ({
      shareId: share.shareId, folder: share.folder, status: share.session.status, peers: share.session.peers.length,
    }))),
  );
  update();
}
