// Wires the Account tab's connect, disconnect and Remote access on the desktop, and the Mirror trigger that follows the open library.
import * as vscode from "vscode";

import { bindMirrorBucket, readCloudflareEmail, systemRelayClock, unbindMirrorBucket, type Invitations, type RelayAccountDeps } from "@labshelf/core";
import type { LibraryRootController } from "../../activation/index.js";
import { provideExternalChangeListener } from "../../activation/index.js";
import { createCloudflareEmailCache, createDesktopRemoteLibrary, CONNECT_RELAY_COMMAND, DISCONNECT_RELAY_COMMAND } from "../../relay/node/index.js";
import { provideAccountDesktop } from "../../account/index.js";
import type { CollabHost } from "./commands.js";

export type RemoteAccessController = Pick<LibraryRootController, "currentServices"> & Partial<Pick<LibraryRootController, "onDidChangeRoot">>;
export type RemoteAccessHost = Pick<CollabHost, "relay" | "logger" | "libraryRoot"> & { invitations: Pick<Invitations, "setInvitationsEnabled"> };

/** The Account tab's connect, disconnect and Remote access; the Mirror trigger follows the open library: on start, after each external-change batch and after a change of library. */
export function registerRemoteAccess(
  context: vscode.ExtensionContext, controller: RemoteAccessController, host: RemoteAccessHost, accessToken: () => Promise<string>, defaultUserName: string,
): void {
  // The user acts on the Account tab, but a refused sign-in is reported as the action's failure rather than offered again here.
  const relayDeps: RelayAccountDeps = { store: host.relay, fetch: globalThis.fetch, logger: host.logger, clock: systemRelayClock, signInAgain: async () => false };
  const remote = createDesktopRemoteLibrary({
    state: context.globalState, libraryRoot: host.libraryRoot, services: () => controller.currentServices(), relay: host.relay, logger: host.logger,
    accessToken,
    enableInvitations: async () => { await host.invitations.setInvitationsEnabled(true); },
    bucket: { bind: () => bindMirrorBucket(relayDeps), unbind: () => unbindMirrorBucket(relayDeps) },
  });
  // Only a sign-in token can read the email; a pasted API token shows the relay alone.
  const cloudflareEmail = createCloudflareEmailCache(async () => {
    const account = await host.relay.get();
    return account?.credential.kind === "oauth" ? readCloudflareEmail(await accessToken()) : undefined;
  });
  provideAccountDesktop({
    defaultUserName,
    cloudflare: {
      status: async () => {
        const status = await host.relay.status();
        if (!status) { return undefined; }
        const email = await cloudflareEmail(status.relayUrl);
        return email ? { ...status, email } : status;
      },
      connect: async () => { await vscode.commands.executeCommand(CONNECT_RELAY_COMMAND); },
      disconnect: async () => { await vscode.commands.executeCommand(DISCONNECT_RELAY_COMMAND); },
    },
    remoteAccess: remote.remoteAccess,
  });
  provideExternalChangeListener(remote.trigger.changed);
  context.subscriptions.push({ dispose: () => { provideAccountDesktop(undefined); provideExternalChangeListener(undefined); remote.trigger.dispose(); } });
  context.subscriptions.push(...[controller.onDidChangeRoot?.(() => remote.trigger.changed())].filter((d) => d !== undefined));
  remote.trigger.start();
}
