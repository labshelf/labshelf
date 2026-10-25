// Offers the owner's relay to a shared project's relay list and withdraws it, for the project of the active editor or one the user picks.
import * as vscode from "vscode";

import { offerOwnRelay, withdrawOwnRelay, type ShareConnection } from "@labshelf/core";
import { CONNECT_RELAY_COMMAND } from "../../../relay/index.js";
import { projectName, reportFailure, showRefusedOffer, type CollabHost } from "../collabHost.js";
import { pickProject } from "./resolveProject.js";

export const OFFER_RELAY_COMMAND = "labshelf.relay.offer";
export const WITHDRAW_RELAY_COMMAND = "labshelf.relay.withdraw";

async function pickShare(host: CollabHost, placeHolder: string): Promise<{ share: ShareConnection; name: string } | undefined> {
  const connected = (shareId: string | undefined) => shareId !== undefined && host.shares.active(shareId) !== undefined;
  const project = await pickProject(host.projects, undefined, (entry) => connected(entry.settings.shared), placeHolder);
  const share = project?.settings.shared ? host.shares.active(project.settings.shared) : undefined;
  if (!project || !share) {
    void vscode.window.showInformationMessage("No shared project is connected in this window.");
    return undefined;
  }
  return { share, name: projectName(project) };
}

/** The relay of the connected Cloudflare account; undefined, with an offer to connect, when there is none. */
async function ownRelayUrl(host: CollabHost): Promise<string | undefined> {
  const account = await host.relay.get();
  if (account) { return account.relayUrl; }
  const connect = "Connect Cloudflare";
  void vscode.window.showInformationMessage("Connect Cloudflare first to have a relay to offer.", connect).then((choice) => {
    if (choice === connect) { void vscode.commands.executeCommand(CONNECT_RELAY_COMMAND); }
  });
  return undefined;
}

export async function offerRelay(host: CollabHost): Promise<void> {
  const relayUrl = await ownRelayUrl(host);
  const picked = relayUrl && (await pickShare(host, "Shared project to offer your relay to"));
  if (!picked) { return; }
  try {
    const offer = await offerOwnRelay(host.ports, picked.share);
    showRefusedOffer(offer);
    if (offer.kind === "offered" || offer.kind === "listed") {
      void vscode.window.showInformationMessage(`Offered your relay at ${relayUrl} to "${picked.name}".`);
    }
  } catch (error) {
    reportFailure(host.logger, `offer your relay to "${picked.name}"`, error, { shareId: picked.share.shareId, relayUrl });
  }
}

export async function withdrawRelay(host: CollabHost): Promise<void> {
  const relayUrl = await ownRelayUrl(host);
  const picked = relayUrl && (await pickShare(host, "Shared project to withdraw your relay from"));
  if (!picked) { return; }
  try {
    const removed = await withdrawOwnRelay(host.ports, picked.share, relayUrl);
    void vscode.window.showInformationMessage(removed ? `Withdrew your relay from "${picked.name}".` : `"${picked.name}" does not list a relay you offered.`);
  } catch (error) {
    reportFailure(host.logger, `withdraw your relay from "${picked.name}"`, error, { shareId: picked.share.shareId, relayUrl });
  }
}
