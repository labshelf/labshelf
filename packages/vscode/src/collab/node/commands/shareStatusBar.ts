// Shows the sharing state of the active project's share in the status bar, with the invite and leave actions on click.
import * as path from "node:path";
import * as vscode from "vscode";

import { currentInvite, type ShareConnection } from "@labshelf/core";
import { projectName, type CollabHost } from "../collabHost.js";
import { copyInvite } from "./copyInvite.js";
import { LEAVE_COMMAND } from "./leaveCommand.js";

const MANAGE_COMMAND = "labshelf.collab.manage";
const STATUS_COMMAND = "labshelf.collab.status";

/** The share of the active editor's file, else the first connected one. */
function currentShare(host: CollabHost): ShareConnection | undefined {
  const document = vscode.window.activeTextEditor?.document;
  const shares = host.shares.list();
  const inFolder = document?.uri.scheme === "file" ? shares.find((share) => document.uri.fsPath.startsWith(share.folder + path.sep)) : undefined;
  return (document && host.editors.of(document)?.share) ?? inFolder ?? shares[0];
}

/** A workers.dev relay goes by its account subdomain, any other by its host. */
function relayName(url: string): string {
  const host = new URL(url).hostname;
  return /^[^.]+\.([^.]+)\.workers\.dev$/.exec(host)?.[1] ?? host;
}

function describeRelays(share: ShareConnection): { text: string; tooltip: string } {
  const listed = share.relays.list();
  if (listed.length === 0) { return { text: "", tooltip: "" }; }
  const { current } = share.relays;
  const lines = listed.map(({ url, downUntil }) => {
    const mark = url === current ? " (in use)" : downUntil ? ` (down until ${new Date(downUntil).toLocaleTimeString()})` : "";
    return `\n- ${url}${mark}`;
  });
  const use = current ? ` Edits also sync through the relay at ${current}.` : " None of the project's relays answers, so edits sync only directly.";
  return { text: current ? ` · via ${relayName(current)}` : "", tooltip: `${use}\nRelays, in the order collaborators try them:${lines.join("")}\n` };
}

function describe(share: ShareConnection): { text: string; tooltip: string } {
  const online = share.session.peers.length;
  const relay = describeRelays(share);
  if (share.session.status === "closed" || online === 0) {
    return { text: `$(broadcast) Shared · offline${relay.text}`, tooltip: `No collaborator is connected. Edits sync when one opens the project.${relay.tooltip}` };
  }
  return { text: `$(broadcast) Shared · ${online} online${relay.text}`, tooltip: `${online} collaborator${online === 1 ? "" : "s"} connected.${relay.tooltip}` };
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
    await copyInvite(await currentInvite(host.ports, share), name);
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
      relayUrl: share.relays.current, relays: share.relays.list(),
    }))),
  );
  update();
}
