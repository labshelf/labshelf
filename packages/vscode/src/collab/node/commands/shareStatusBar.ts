// Shows the sharing state of the active project's share in the status bar, and opens its share dialog on click.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ShareConnection } from "@labshelf/core";
import { sharingWebviews } from "../../../sharing/index.js";
import type { CollabHost } from "../collabHost.js";

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

export function registerShareStatusBar(context: vscode.ExtensionContext, host: CollabHost): void {
  const item = vscode.window.createStatusBarItem("labshelf.collab", vscode.StatusBarAlignment.Left, 49);
  item.name = "LabShelf Sharing";
  item.command = MANAGE_COMMAND;
  const update = (): void => {
    const share = currentShare(host);
    if (!share) { item.hide(); return; }
    const { text, tooltip } = describe(share);
    item.text = text;
    item.tooltip = `${tooltip} Click to manage the project's sharing.`;
    item.show();
  };
  context.subscriptions.push(
    item,
    host.shares.onDidChange(update),
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.commands.registerCommand(MANAGE_COMMAND, async () => {
      const share = currentShare(host);
      if (share) { await sharingWebviews.open({ kind: "shareProject", projectId: share.folder }); }
    }),
    // For scripts and end-to-end runs: the connected shares as plain data.
    vscode.commands.registerCommand(STATUS_COMMAND, () => host.shares.list().map((share) => ({
      shareId: share.shareId, folder: share.folder, status: share.session.status, peers: share.session.peers.length,
      relayUrl: share.relays.current, relays: share.relays.list(),
    }))),
  );
  update();
}
