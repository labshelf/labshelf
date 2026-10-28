// Wires the owner's Cloudflare relay on the desktop: the connect and disconnect commands and the update on start.
import * as vscode from "vscode";

import { removeRelayAccount, readRelayWorkerScript, updateOwnRelay } from "@labshelf/core";
import { createLazyProgress } from "./accounts.js";
import {
  connectRelay,
  CONNECT_RELAY_COMMAND,
  createRelayAccountDeps,
  reportRelayFailure,
  type ConnectDeps,
  type RelayDeps,
} from "./connect.js";

async function updateRelayOnStart(deps: RelayDeps): Promise<void> {
  try {
    await updateOwnRelay({ ...createRelayAccountDeps(deps), script: readRelayWorkerScript() });
  } catch (error) {
    reportRelayFailure(deps.logger, "update your relay", error);
  }
}

const DISCONNECT_RELAY_COMMAND = "labshelf.relay.disconnect";

interface DisconnectDeps extends ConnectDeps {
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

async function disconnectRelay(deps: DisconnectDeps): Promise<void> {
  const account = await deps.accounts.get();
  if (!account) {
    void vscode.window.showInformationMessage("Cloudflare is not connected.");
    return;
  }
  if (!(await confirmDisconnect(account.relayUrl))) { return; }
  try {
    const progress = createLazyProgress("Deleting your relay from Cloudflare");
    try {
      await removeRelayAccount({ ...createRelayAccountDeps(deps), withdrawFromShares: deps.withdrawFromShares, progress: () => progress.report("") });
    } finally {
      progress.close();
    }
    void vscode.window.showInformationMessage("Cloudflare disconnected, and your relay is deleted.");
  } catch (error) {
    reportRelayFailure(deps.logger, "disconnect Cloudflare", error);
  }
}

export function registerRelay(context: vscode.ExtensionContext, deps: DisconnectDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CONNECT_RELAY_COMMAND, () => connectRelay(deps)),
    vscode.commands.registerCommand(DISCONNECT_RELAY_COMMAND, () => disconnectRelay(deps)),
  );
  // Never awaited: activation does not wait on the network.
  void updateRelayOnStart(deps);
}
