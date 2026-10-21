// Declares what the desktop folder links run over: the open library's device share list and the owner's connected relay.
import * as vscode from "vscode";

import type { RelayAccount, RelayAccountStore, ShareRegistryStore } from "@labshelf/core";
import { deviceLocalLayout, fileShareRegistryStore } from "@labshelf/core/node";
import { CONNECT_RELAY_COMMAND } from "../../relay/index.js";

export interface ShareLinkHost {
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
