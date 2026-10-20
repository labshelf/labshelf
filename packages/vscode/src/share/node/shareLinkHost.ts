// Declares what the share-link commands run over on the desktop, the device's share list of the open library, and how a failure is reported.
import * as vscode from "vscode";

import { shareFailureText, type ILogger, type RelayAccount, type RelayAccountStore, type ShareRegistryStore } from "@labshelf/core";
import { deviceLocalLayout, fileShareRegistryStore } from "@labshelf/core/node";
import type { ActiveServices } from "../../commands/index.js";
import { CONNECT_RELAY_COMMAND } from "../../relay/index.js";

const LOG_MODULE = "share";

export interface ShareLinkHost {
  requireServices: () => Promise<ActiveServices | null>;
  libraryRoot: () => string | undefined;
  relay: RelayAccountStore;
}

/** The share list of the open library; undefined when no library is open. */
export function shareRegistry(host: ShareLinkHost): ShareRegistryStore | undefined {
  const root = host.libraryRoot();
  return root === undefined ? undefined : fileShareRegistryStore(deviceLocalLayout(root).shareRegistryPath);
}

/** The connected Cloudflare account; undefined, with an offer to connect, when there is none. */
export async function connectedRelay(host: ShareLinkHost, why: string): Promise<RelayAccount | undefined> {
  const account = await host.relay.get();
  if (account) { return account; }
  const connect = "Connect Cloudflare";
  void vscode.window.showInformationMessage(`Connect Cloudflare first: ${why}`, connect).then((choice) => {
    if (choice === connect) { void vscode.commands.executeCommand(CONNECT_RELAY_COMMAND); }
  });
  return undefined;
}

/** `context` must hold no link key, owner secret or token. */
export function reportShareFailure(logger: ILogger, action: string, error: unknown, context: Record<string, unknown>): void {
  void logger.error(LOG_MODULE, error, { ...context, action });
  void vscode.window.showErrorMessage(shareFailureText(action, error));
}
