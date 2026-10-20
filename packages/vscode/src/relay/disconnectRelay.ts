// Disconnects Cloudflare: takes the owner's relay out of the shared projects, deletes it from the account and forgets its credential.
import * as vscode from "vscode";

import { disconnectRelayAccount } from "@labshelf/core";
import type { ConnectDeps } from "./connectRelay.js";
import { relayAccountDeps } from "./relayAccountDeps.js";
import { lazyProgress } from "./relayProgress.js";
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
      + "Shared projects that list no other relay stop syncing until someone offers one.",
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
    const progress = lazyProgress("Deleting your relay from Cloudflare");
    try {
      await disconnectRelayAccount({ ...relayAccountDeps(deps), withdrawFromShares: deps.withdrawFromShares, progress: () => progress.report("") });
    } finally {
      progress.close();
    }
    void vscode.window.showInformationMessage("Cloudflare disconnected, and your relay is deleted.");
  } catch (error) {
    reportRelayFailure(deps.logger, "disconnect Cloudflare", error);
  }
}
