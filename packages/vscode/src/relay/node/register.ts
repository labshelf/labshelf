// Wires the owner's Cloudflare relay on the desktop: the connect and disconnect commands and the update on start.
import * as vscode from "vscode";

import { removeRelayAccount, readRelayWorkerScript, updateOwnRelay } from "@labshelf/core";
import { createLazyProgress, openRelayLifecycleLock } from "./accounts.js";
import {
  connectRelay,
  CONNECT_RELAY_COMMAND,
  createRelayAccountDeps,
  reportRelayFailure,
  type ConnectDeps,
} from "./connect.js";
import { registerRotation, retireRotatedOutRelay, type RotateDeps } from "./rotate.js";

async function updateRelayOnStart(deps: RotateDeps): Promise<void> {
  try {
    await deps.withLock(() => updateOwnRelay({ ...createRelayAccountDeps(deps), script: readRelayWorkerScript() }));
  } catch (error) {
    reportRelayFailure(deps.logger, "update your relay", error);
  }
}

export const DISCONNECT_RELAY_COMMAND = "labshelf.relay.disconnect";

interface DisconnectDeps extends ConnectDeps {
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
}

export interface RegisterRelayDeps extends DisconnectDeps {
  /** True while a share is open in this window; the hourly abuse check runs only then. */
  hasOpenShare(): boolean;
  /** Moves the directory registration and the cards to the new relay after a rotation (the invitations' `updateAfterRotation`). */
  updateRegistration?(change: { previousUrl: string; relayUrl: string }): Promise<void>;
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

export function registerRelay(context: vscode.ExtensionContext, deps: RegisterRelayDeps): void {
  const rotateDeps: RotateDeps = { ...deps, withLock: openRelayLifecycleLock(context.secrets) };
  context.subscriptions.push(
    vscode.commands.registerCommand(CONNECT_RELAY_COMMAND, () => connectRelay(deps)),
    vscode.commands.registerCommand(DISCONNECT_RELAY_COMMAND, () => disconnectRelay(deps)),
  );
  registerRotation(context, rotateDeps);
  // Never awaited: activation does not wait on the network.
  void updateRelayOnStart(rotateDeps).then(() => retireRotatedOutRelay(rotateDeps));
}
