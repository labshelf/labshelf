// Offers the owner's relay to a share's relay list, claiming the share on it first, and withdraws it again.
// CONTRACT: documents/contracts/collaboration.md#relay-list
import { deriveRelayToken } from "../../crypto/index.js";
import { addRelay, relayList, removeOwnRelay } from "../../relays/index.js";
import type { ShareConnection } from "../../session/index.js";
import { claimShare } from "../../transport/index.js";
import { currentInvite } from "./currentInvite.js";
import { LOG_MODULE, type ShareWorkflowPorts } from "./sharePorts.js";

export type OwnRelayOffer = { kind: "offered" | "listed" | "noRelay" } | { kind: "refused"; error: unknown };

/** Claims the share on the owner's relay and appends it to the list; a refused claim leaves the list as it is. */
export async function offerOwnRelay(ports: ShareWorkflowPorts, share: ShareConnection): Promise<OwnRelayOffer> {
  const account = await ports.relay.get();
  if (!account) { return { kind: "noRelay" }; }
  const { shareId, shareKey } = share;
  const { relayUrl } = account;
  if (relayList(share.session.index).some((entry) => entry.url === relayUrl)) { return { kind: "listed" }; }
  try {
    // The token derives from the share key, so the list never holds it.
    const relayToken = await deriveRelayToken(shareKey);
    await claimShare({ relayUrl, ownerSecret: account.ownerSecret, shareId, relayToken, ...(ports.fetch ? { fetch: ports.fetch } : {}) });
  } catch (error) {
    void ports.logger.log("WARN", LOG_MODULE, "The owner's relay refused the share; it stays off the share's list", { shareId, relayUrl, error: String(error) });
    return { kind: "refused", error };
  }
  addRelay(share.session.index, { url: relayUrl, addedBy: ports.userName() });
  await currentInvite(ports, share);
  void ports.logger.log("INFO", LOG_MODULE, "Offered the owner's relay to a share", { shareId, relayUrl });
  return { kind: "offered" };
}

/** Takes the relay out of the list where this user offered it; false when they did not, since only its adder removes an entry. */
export async function withdrawOwnRelay(ports: ShareWorkflowPorts, share: ShareConnection, relayUrl: string): Promise<boolean> {
  if (!removeOwnRelay(share.session.index, relayUrl, ports.userName())) { return false; }
  await currentInvite(ports, share);
  void ports.logger.log("INFO", LOG_MODULE, "Withdrew the owner's relay from a share", { shareId: share.shareId, relayUrl });
  return true;
}

/** Offers the owner's relay to every connected share; resolves to the offers that were refused. */
export async function offerOwnRelayToShares(ports: ShareWorkflowPorts): Promise<OwnRelayOffer[]> {
  const refused: OwnRelayOffer[] = [];
  for (const share of ports.shares.list()) {
    const offer = await offerOwnRelay(ports, share);
    if (offer.kind === "refused") { refused.push(offer); }
  }
  return refused;
}

/** Withdraws the relay from the connected shares, and from the stored invites of the shared projects that are not connected. */
export async function withdrawOwnRelayFromShares(ports: ShareWorkflowPorts, relayUrl: string): Promise<void> {
  // A trashed project keeps its key, so its stored invite loses the relay too.
  const shareIds = ports.projects.list().flatMap((entry) => (entry.kind === "ready" && entry.settings.shared ? [entry.settings.shared] : []));
  for (const shareId of shareIds) {
    const share = ports.shares.active(shareId);
    if (share) { await withdrawOwnRelay(ports, share, relayUrl); continue; }
    const stored = await ports.keys.invite(shareId);
    if (!stored?.relays.some((relay) => relay.url === relayUrl)) { continue; }
    await ports.keys.remember({ ...stored, relays: stored.relays.filter((relay) => relay.url !== relayUrl) });
    void ports.logger.log("INFO", LOG_MODULE, "Took the owner's relay out of a stored invite", { shareId, relayUrl });
  }
}
