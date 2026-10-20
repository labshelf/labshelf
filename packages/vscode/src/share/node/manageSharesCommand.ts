// Lists the shares this device made of library folders, and copies, opens or revokes the link of the one picked.
import * as vscode from "vscode";

import { loadShareRegistry, relayBackendFor, revokeShare, revokeShareConfirm, shareRecordLink, type ShareRecord, type ShareRegistryStore } from "@labshelf/core";
import type { ActiveServices } from "../../commands/index.js";
import { reportShareFailure, shareRegistry, type ShareLinkHost } from "./shareLinkHost.js";

export const MANAGE_SHARES_COMMAND = "labshelf.share.manage";

type Action = "copy" | "open" | "revoke";

async function pickShare(shares: ShareRecord[]): Promise<ShareRecord | undefined> {
  const items = [...shares].reverse().map((share) => ({
    label: share.folder, description: new Date(share.createdAt).toLocaleString(), detail: new URL(share.relayUrl).host, share,
  }));
  return (await vscode.window.showQuickPick(items, { placeHolder: "Shared link to manage", matchOnDescription: true }))?.share;
}

async function pickAction(share: ShareRecord): Promise<Action | undefined> {
  const items: (vscode.QuickPickItem & { action: Action })[] = [
    { label: "Copy Link", action: "copy" },
    { label: "Open Link", action: "open" },
    { label: "Revoke Link…", description: "anyone who has it can no longer open it", action: "revoke" },
  ];
  return (await vscode.window.showQuickPick(items, { placeHolder: `Link to "${share.folder}"` }))?.action;
}

async function revoke(host: ShareLinkHost, services: ActiveServices, registry: ShareRegistryStore, share: ShareRecord): Promise<void> {
  const confirm = revokeShareConfirm(share.folder);
  if ((await vscode.window.showWarningMessage(confirm.message, { modal: true, detail: confirm.detail }, "Revoke")) !== "Revoke") { return; }
  const backendFor = relayBackendFor(await host.relay.get());
  const revoked = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Revoking the link to "${share.folder}"` }, () =>
    revokeShare(share.id, { registry, backendFor, logger: services.logger }));
  void vscode.window.showInformationMessage(revoked ? `Revoked the link to "${share.folder}".` : `The link to "${share.folder}" is no longer listed on this device.`);
}

export async function manageShares(host: ShareLinkHost): Promise<void> {
  const services = await host.requireServices();
  const registry = shareRegistry(host);
  if (!services || !registry) { return; }
  let picked: ShareRecord | undefined;
  try {
    const { shares } = await loadShareRegistry(registry);
    if (shares.length === 0) {
      void vscode.window.showInformationMessage("This device has shared no folder of this library as a link.");
      return;
    }
    picked = await pickShare(shares);
    const action = picked && (await pickAction(picked));
    if (!picked || !action) { return; }
    if (action === "copy") {
      await vscode.env.clipboard.writeText(shareRecordLink(picked));
      void vscode.window.showInformationMessage(`Copied the link to "${picked.folder}".`);
    } else if (action === "open") {
      await vscode.env.openExternal(vscode.Uri.parse(shareRecordLink(picked)));
    } else {
      await revoke(host, services, registry, picked);
    }
  } catch (error) {
    reportShareFailure(services.logger, picked ? `manage the link to "${picked.folder}"` : "read this device's shared links", error, { shareId: picked?.id });
  }
}
