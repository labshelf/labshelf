// Disconnects Cloudflare: takes the owner's relay out of the shared projects, deletes it from the account and forgets the token.
import * as vscode from "vscode";

import { deleteRelay } from "@labshelf/core";
import type { ConnectDeps } from "./connectRelay.js";
import { LOG_MODULE, RELAY_WORKER_NAME } from "./relayAccounts.js";
import { reportRelayFailure } from "./relayFailure.js";

export const DISCONNECT_RELAY_COMMAND = "labshelf.relay.disconnect";

export interface DisconnectDeps extends ConnectDeps {
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
}

async function confirmDisconnect(relayUrl: string): Promise<boolean> {
  const disconnect = "Disconnect";
  const answer = await vscode.window.showWarningMessage("Disconnect Cloudflare and delete your relay?", {
    modal: true,
    detail: `LabShelf deletes the relay at ${relayUrl} from your Cloudflare account, with the encrypted edits it keeps, and takes it out of your shared projects. `
      + "Collaborators keep syncing directly while they are online together.",
  }, disconnect);
  return answer === disconnect;
}

export async function disconnectRelay(deps: DisconnectDeps): Promise<void> {
  const account = await deps.accounts.get();
  if (!account) {
    void vscode.window.showInformationMessage("Cloudflare is not connected.");
    return;
  }
  if (!(await confirmDisconnect(account.relayUrl))) { return; }
  try {
    const { token, accountId, kvNamespaceId, turnKeyId, relayUrl } = account;
    // Withdrawn first, so collaborators move to the next relay before this one stops answering.
    await deps.withdrawFromShares(relayUrl);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Deleting your relay from Cloudflare" }, () =>
      deleteRelay({ token, accountId, workerName: RELAY_WORKER_NAME, kvNamespaceId, turnKeyId, logger: deps.logger, fetch: globalThis.fetch }));
    await deps.accounts.forget();
    void deps.logger.log("INFO", LOG_MODULE, "Disconnected Cloudflare", { accountId, relayUrl });
    void vscode.window.showInformationMessage("Cloudflare disconnected, and your relay is deleted.");
  } catch (error) {
    reportRelayFailure(deps.logger, "disconnect Cloudflare", error);
  }
}
