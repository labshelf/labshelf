// Puts the owner's relay into a share's invite, claiming the share on it first, and takes it out of every share again.
import * as vscode from "vscode";

import { claimShare, deriveRelayToken, formatInvite, type Invite } from "@labshelf/core";
import { errorText, LOG_MODULE, type CollabHost } from "./collabHost.js";

export interface StoredInvite { link: string; invite: Invite }

/**
 * The invite with the owner's relay listed first, so the share syncs through it; unchanged when no relay is connected,
 * the relay is already listed, or it refuses the claim, which is logged and shown.
 */
export async function withOwnRelay(host: CollabHost, invite: Invite): Promise<StoredInvite> {
  const unchanged = async () => ({ link: await formatInvite(invite), invite });
  const account = await host.relay.get();
  if (!account || invite.relays.some((relay) => relay.url === account.relayUrl)) { return unchanged(); }
  const { shareId, shareKey } = invite;
  try {
    // CONTRACT: documents/contracts/collaboration.md#invite-link — the token derives from the share key, so the entry omits it.
    await claimShare({ relayUrl: account.relayUrl, ownerSecret: account.ownerSecret, shareId, relayToken: await deriveRelayToken(shareKey) });
  } catch (error) {
    void host.logger.log("WARN", LOG_MODULE, "The owner's relay refused the share; sharing without it", { shareId, relayUrl: account.relayUrl, error: errorText(error) });
    void vscode.window.showWarningMessage(`Your relay did not take the project, so it is shared without it: ${errorText(error)}`);
    return unchanged();
  }
  void host.logger.log("INFO", LOG_MODULE, "Claimed the share on the owner's relay", { shareId, relayUrl: account.relayUrl });
  const withRelay = { ...invite, relays: [{ url: account.relayUrl }, ...invite.relays] };
  return { link: await formatInvite(withRelay), invite: withRelay };
}

/** Rewrites the stored invites of the shared projects without the relay, then reconnects the shares that used it. */
export async function dropRelayFromShares(host: CollabHost, relayUrl: string): Promise<void> {
  const shareIds = host.projects.list().flatMap((entry) => (entry.kind === "ready" && entry.settings.shared ? [entry.settings.shared] : []));
  for (const shareId of shareIds) {
    const stored = await host.keys.invite(shareId);
    if (!stored?.invite.relays.some((relay) => relay.url === relayUrl)) { continue; }
    const invite = { ...stored.invite, relays: stored.invite.relays.filter((relay) => relay.url !== relayUrl) };
    await host.keys.remember(await formatInvite(invite), shareId);
    if (host.shares.get(shareId)?.relayUrl === relayUrl) { await host.shares.remove(shareId); }
    void host.logger.log("INFO", LOG_MODULE, "Took the deleted relay out of a share", { shareId, relayUrl });
  }
  // The project list reload reconnects the removed shares from their rewritten invites.
  await host.projects.reload();
}
