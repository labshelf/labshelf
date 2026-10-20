// Shares a project from this device, or reconnects one shared before, and hands back the invite link to send.
import { deriveShareId, generateShareKey } from "../../crypto/index.js";
import type { ShareConnection } from "../../session/index.js";
import { currentInvite } from "./currentInvite.js";
import { clearSharedField } from "./leaveSharedProject.js";
import { offerOwnRelay, type OwnRelayOffer } from "./ownRelay.js";
import { LOG_MODULE, type ShareWorkflowPorts } from "./sharePorts.js";

export interface ShareRequest {
  folder: string;
  /** The project's `shared` field; set when it is shared already. */
  shared: string | undefined;
  signal: AbortSignal;
}

export type ShareOutcome =
  | { kind: "shared"; invite: string; connection: ShareConnection; offer: OwnRelayOffer }
  /** No relay is connected and the user did not connect one; nothing was published. */
  | { kind: "noRelay" }
  /** The project is shared, but this device holds no key of it. */
  | { kind: "noKey" };

interface Offered { connection: ShareConnection; offer: OwnRelayOffer }

export async function shareProject(ports: ShareWorkflowPorts, request: ShareRequest): Promise<ShareOutcome> {
  const shared = request.shared === undefined ? await shareNew(ports, request) : await reconnect(ports, request.folder, request.shared);
  if (shared === "noRelay" || shared === "noKey") { return { kind: shared }; }
  return { kind: "shared", invite: await currentInvite(ports, shared.connection), ...shared };
}

async function reconnect(ports: ShareWorkflowPorts, folder: string, shareId: string): Promise<Offered | "noKey"> {
  const stored = await ports.keys.invite(shareId);
  if (!stored) { return "noKey"; }
  const connection = await ports.shares.hold(shareId, async () => {
    const active = ports.shares.active(shareId);
    if (active) { return active; }
    const resumed = await ports.connect(stored, { mode: "resume", folder });
    ports.shares.add(resumed);
    return resumed;
  });
  return { connection, offer: await offerOwnRelay(ports, connection) };
}

async function shareNew(ports: ShareWorkflowPorts, { folder, signal }: ShareRequest): Promise<Offered | "noRelay"> {
  // INVARIANT: nothing is published before a relay exists, since a joiner reaches the share only through one.
  if (!(await ports.relay.get()) && !((await ports.requireRelay()) && (await ports.relay.get()))) {
    void ports.logger.log("INFO", LOG_MODULE, "Sharing cancelled: no relay is connected", { folder });
    return "noRelay";
  }
  if (signal.aborted) { throw new Error("Sharing was cancelled"); }
  const shareKey = generateShareKey();
  const shareId = await deriveShareId(shareKey);
  return ports.shares.hold(shareId, async () => {
    // The key is stored before connecting, so the project list reload that the new `shared` field causes finds it.
    await ports.keys.remember({ shareId, shareKey, relays: [] });
    try {
      const connection = await ports.connect({ shareId, shareKey, relays: [] }, { mode: "share", folder });
      ports.shares.add(connection);
      if (signal.aborted) { throw new Error("Sharing was cancelled"); }
      await ports.projects.reload();
      // A new share lists no other relay, so an invite without the owner's would reach nobody.
      const offer = await offerOwnRelay(ports, connection);
      if (offer.kind === "refused") { throw new Error(`Your relay refused the share: ${String(offer.error)}`, { cause: offer.error }); }
      void ports.logger.log("INFO", LOG_MODULE, "Shared a project", { folder, shareId });
      return { connection, offer };
    } catch (error) {
      await rollBack(ports, folder, shareId);
      throw error;
    }
  });
}

/** Undoes what a failed or cancelled share wrote; the share id is fresh, so all of it belongs to this operation. */
async function rollBack(ports: ShareWorkflowPorts, folder: string, shareId: string): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["close the connection", () => ports.shares.remove(shareId)],
    ["forget the key", () => ports.keys.forget(shareId)],
    ["clear the shared field", () => clearSharedField(ports.files, folder, shareId)],
    ["delete the share state", () => ports.deleteState(shareId)],
    ["reload the projects", () => ports.projects.reload()],
  ];
  for (const [action, step] of steps) {
    await step().catch((error: unknown) => ports.logger.error(LOG_MODULE, error, { action: `roll back a share: ${action}`, folder, shareId }));
  }
  void ports.logger.log("INFO", LOG_MODULE, "Rolled back a share that did not complete", { folder, shareId });
}
