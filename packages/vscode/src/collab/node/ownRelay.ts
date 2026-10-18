// Offers the owner's relay to a share's relay list, claiming the share on it first, withdraws it again, and keeps the invite on that list.
import * as vscode from "vscode";

import { addRelay, claimShare, deriveRelayToken, formatInvite, relayList, removeOwnRelay } from "@labshelf/core";
import { errorText, LOG_MODULE, type CollabHost } from "./collabHost.js";
import type { ShareConnection } from "./session/index.js";
import { userName } from "./userName.js";

/** Stores the share's invite with the relays of its index list, which is the link to hand out; resolves to that link. */
export async function rememberInvite(host: CollabHost, share: ShareConnection): Promise<string> {
  const { shareId, shareKey } = share;
  const link = await formatInvite({ shareKey, relays: relayList(share.session.index).map(({ url }) => ({ url })) });
  await host.keys.remember(link, shareId);
  return link;
}

/**
 * Claims the share on the owner's relay and appends it to the share's list; false when no relay is connected or it refuses
 * the claim, which is logged and shown. A relay listed already is left as it is.
 */
export async function offerOwnRelay(host: CollabHost, share: ShareConnection): Promise<boolean> {
  const account = await host.relay.get();
  if (!account) { return false; }
  const { shareId, shareKey } = share;
  const { relayUrl } = account;
  if (relayList(share.session.index).some((entry) => entry.url === relayUrl)) { return true; }
  try {
    // CONTRACT: documents/contracts/collaboration.md#relay-list — the token derives from the share key, so the list omits it.
    await claimShare({ relayUrl, ownerSecret: account.ownerSecret, shareId, relayToken: await deriveRelayToken(shareKey) });
  } catch (error) {
    void host.logger.log("WARN", LOG_MODULE, "The owner's relay refused the share; it stays off the share's list", { shareId, relayUrl, error: errorText(error) });
    void vscode.window.showWarningMessage(`Your relay did not take the project, so it syncs without it: ${errorText(error)}`);
    return false;
  }
  addRelay(share.session.index, { url: relayUrl, addedBy: userName() });
  await rememberInvite(host, share);
  void host.logger.log("INFO", LOG_MODULE, "Offered the owner's relay to a share", { shareId, relayUrl });
  return true;
}

/** Takes the relay out of the share's list where this user offered it; false when they did not. */
export async function withdrawOwnRelay(host: CollabHost, share: ShareConnection, relayUrl: string): Promise<boolean> {
  if (!removeOwnRelay(share.session.index, relayUrl, userName())) { return false; }
  await rememberInvite(host, share);
  void host.logger.log("INFO", LOG_MODULE, "Withdrew the owner's relay from a share", { shareId: share.shareId, relayUrl });
  return true;
}

/** Offers the owner's relay to every share connected in this window. */
export async function offerToShares(host: CollabHost): Promise<void> {
  for (const share of host.shares.list()) { await offerOwnRelay(host, share); }
}

/** Withdraws the relay from the connected shares, and takes it out of the stored invites of the shared projects that are not connected. */
export async function withdrawFromShares(host: CollabHost, relayUrl: string): Promise<void> {
  const shareIds = host.projects.list().flatMap((entry) => (entry.kind === "ready" && entry.settings.shared ? [entry.settings.shared] : []));
  for (const shareId of shareIds) {
    const share = host.shares.get(shareId);
    if (share) { await withdrawOwnRelay(host, share, relayUrl); continue; }
    const stored = await host.keys.invite(shareId);
    if (!stored?.invite.relays.some((relay) => relay.url === relayUrl)) { continue; }
    const invite = { ...stored.invite, relays: stored.invite.relays.filter((relay) => relay.url !== relayUrl) };
    await host.keys.remember(await formatInvite(invite), shareId);
    void host.logger.log("INFO", LOG_MODULE, "Took the owner's relay out of a stored invite", { shareId, relayUrl });
  }
}
