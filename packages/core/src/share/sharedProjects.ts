/**
 * What the shared-project workflows stand on: the ports an app implements, the current invite, the own-relay offer and resuming
 * shared projects.
 */
import type { ILogger } from "../ports/index.js";
import type { RelayAccount } from "../relay/index.js";
import type { ProjectEntry, ProjectReadContext } from "../writing/project/index.js";
import { type Invite, deriveRelayToken, formatInvite } from "../collab/invite/index.js";
import type { ShareConnection, ShareStart } from "../collab/session/index.js";
import { addRelay, addRelayShare, readRelayList, removeOwnRelay } from "../collab/relays/index.js";

/** What a device keeps of a share: its key and the relays to try while the index lists none. */
export type StoredInvite = Pick<Invite, "shareId" | "shareKey" | "relays">;

/** Device-local and secret: VS Code keeps it in SecretStorage, the browser in extension storage. */
export interface ShareKeyStore {
  remember(invite: StoredInvite): Promise<void>;
  /** Undefined when this device holds no usable key of the share. */
  invite(shareId: string): Promise<StoredInvite | undefined>;
  forget(shareId: string): Promise<void>;
}

/** The shares connected on this device, at most one connection per share. */
export interface ShareConnections {
  active(shareId: string): ShareConnection | undefined;
  list(): readonly ShareConnection[];
  /** True while `hold` runs for the share; the project list then lags behind and must not be acted on. */
  isBusy(shareId: string): boolean;
  hold<T>(shareId: string, run: () => Promise<T>): Promise<T>;
  add(connection: ShareConnection): void;
  /**
   * Closes the share's connection and resolves once its updates are stored; rejects with the close error when they stay unstored,
   * so a leave keeps the key. Resolves at once when the share is not connected.
   */
  remove(shareId: string): Promise<void>;
}

export interface SharedProjectCatalog {
  list(): readonly ProjectEntry[];
  /** Re-reads the projects, so a `shared` field a workflow wrote shows in `list`. */
  reload(): Promise<void>;
}

export interface ShareFlowPorts {
  keys: ShareKeyStore;
  shares: ShareConnections;
  projects: SharedProjectCatalog;
  /** Reads and writes labshelf.yaml. */
  files: ProjectReadContext;
  /** The owner's Cloudflare relay, when this device connected one. */
  relay: { get(): Promise<RelayAccount | undefined> };
  /** Lets the user connect a relay when none is; false when they did not. */
  requireRelay(): Promise<boolean>;
  /** Connects a share in the open library; the workflow adds the result to `shares`. */
  connect(invite: StoredInvite, start: ShareStart): Promise<ShareConnection>;
  /** Deletes this device's stored state of the share (Yjs docs, blobs, cursors). */
  deleteState(shareId: string): Promise<void>;
  /** This user's name, which marks the relays they offered. */
  userName(): string;
  logger: ILogger;
  /** Tests pass a relay that runs in process. */
  fetch?: typeof fetch;
}

/** Another tab of this profile runs the share; the connect port rejects with it and the share stays observed until that tab closes. */
export class ShareOpenInAnotherTabError extends Error {
  constructor(readonly shareId: string) { super("This shared project is open in another tab"); }
}

export const LOG_MODULE = "collab.share";

export type SharedProject = Extract<ProjectEntry, { kind: "ready" }> & { settings: { shared: string } };

export const isSharedProject = (entry: ProjectEntry): entry is SharedProject =>
  entry.kind === "ready" && typeof entry.settings.shared === "string" && !entry.settings.trashed;

/**
 * The link to hand out. A stored link goes stale as members offer and withdraw relays, so it is never handed out as stored.
 * CONTRACT: documents/contracts/collaboration.md#relay-list — the invite's relays stand in while the index lists none.
 */
export async function readCurrentInvite(ports: Pick<ShareFlowPorts, "keys">, share: ShareConnection): Promise<string> {
  const { shareId, shareKey } = share;
  const listed = readRelayList(share.session.index).map(({ url }) => ({ url }));
  const relays = listed.length > 0 ? listed : (await ports.keys.invite(shareId))?.relays ?? [];
  await ports.keys.remember({ shareId, shareKey, relays });
  return formatInvite({ shareKey, relays });
}

export type OwnRelayOffer = { kind: "offered" | "listed" | "noRelay" } | { kind: "refused"; error: unknown };

/** Claims the share on the owner's relay and appends it to the list; a refused claim leaves the list as it is. */
export async function offerOwnRelay(ports: ShareFlowPorts, share: ShareConnection): Promise<OwnRelayOffer> {
  const account = await ports.relay.get();
  if (!account) { return { kind: "noRelay" }; }
  const { shareId, shareKey } = share;
  const { relayUrl } = account;
  if (readRelayList(share.session.index).some((entry) => entry.url === relayUrl)) { return { kind: "listed" }; }
  try {
    // The token derives from the share key, so the list never holds it.
    const relayToken = await deriveRelayToken(shareKey);
    await addRelayShare({ relayUrl, ownerSecret: account.ownerSecret, shareId, relayToken, ...(ports.fetch ? { fetch: ports.fetch } : {}) });
  } catch (error) {
    void ports.logger.log("WARN", LOG_MODULE, "The owner's relay refused the share; it stays off the share's list", { shareId, relayUrl, error: String(error) });
    return { kind: "refused", error };
  }
  addRelay(share.session.index, { url: relayUrl, addedBy: ports.userName() });
  await readCurrentInvite(ports, share);
  void ports.logger.log("INFO", LOG_MODULE, "Offered the owner's relay to a share", { shareId, relayUrl });
  return { kind: "offered" };
}

/** Takes the relay out of the list where this user offered it; false when they did not, since only its adder removes an entry. */
export async function removeOwnRelayOffer(ports: ShareFlowPorts, share: ShareConnection, relayUrl: string): Promise<boolean> {
  if (!removeOwnRelay(share.session.index, relayUrl, ports.userName())) { return false; }
  await readCurrentInvite(ports, share);
  void ports.logger.log("INFO", LOG_MODULE, "Withdrew the owner's relay from a share", { shareId: share.shareId, relayUrl });
  return true;
}

/** Offers the owner's relay to every connected share; resolves to the offers that were refused. */
export async function offerOwnRelayToShares(ports: ShareFlowPorts): Promise<OwnRelayOffer[]> {
  const refused: OwnRelayOffer[] = [];
  for (const share of ports.shares.list()) {
    const offer = await offerOwnRelay(ports, share);
    if (offer.kind === "refused") { refused.push(offer); }
  }
  return refused;
}

/** Withdraws the relay from the connected shares, and from the stored invites of the shared projects that are not connected. */
export async function removeOwnRelayOfferFromShares(ports: ShareFlowPorts, relayUrl: string): Promise<void> {
  // A trashed project keeps its key, so its stored invite loses the relay too.
  const shareIds = ports.projects.list().flatMap((entry) => (entry.kind === "ready" && entry.settings.shared ? [entry.settings.shared] : []));
  for (const shareId of shareIds) {
    const share = ports.shares.active(shareId);
    if (share) { await removeOwnRelayOffer(ports, share, relayUrl); continue; }
    const stored = await ports.keys.invite(shareId);
    if (!stored?.relays.some((relay) => relay.url === relayUrl)) { continue; }
    await ports.keys.remember({ ...stored, relays: stored.relays.filter((relay) => relay.url !== relayUrl) });
    void ports.logger.log("INFO", LOG_MODULE, "Took the owner's relay out of a stored invite", { shareId, relayUrl });
  }
}

export interface ResumeReports {
  /** Once per share: the project is shared, but this device holds no key of it. */
  missingKey(project: SharedProject): void;
  /** Once per share: the reconnect failed, and the next pass would fail the same way. */
  failed(project: SharedProject, error: unknown): void;
}

export interface ShareResumer {
  /** Runs one pass after the passes already queued; call it on every reload of the project list. */
  sync(): Promise<void>;
}

export function createShareResumer(ports: ShareFlowPorts, reports: ResumeReports): ShareResumer {
  const reported = new Set<string>();
  let running = Promise.resolve();
  return {
    sync: () => (running = running.then(() => syncPass(ports, reports, reported))),
  };
}

async function syncPass(ports: ShareFlowPorts, reports: ResumeReports, reported: Set<string>): Promise<void> {
  const shared = ports.projects.list().filter(isSharedProject);
  for (const share of ports.shares.list()) {
    if (ports.shares.isBusy(share.shareId)) { continue; }
    if (shared.some((project) => project.folder === share.folder && project.settings.shared === share.shareId)) { continue; }
    void ports.logger.log("INFO", LOG_MODULE, "Disconnected a share whose project left the list", { folder: share.folder, shareId: share.shareId });
    await ports.shares.remove(share.shareId).catch((error: unknown) =>
      ports.logger.error(LOG_MODULE, error, { action: "close a share whose project left the list", shareId: share.shareId }));
  }
  for (const project of shared) {
    const shareId = project.settings.shared;
    if (ports.shares.active(shareId) || ports.shares.isBusy(shareId) || reported.has(shareId)) { continue; }
    await resume(ports, project, reports, reported).catch((error: unknown) => {
      reported.add(shareId);
      // Expected state, not a failure: the other tab runs the share and this one takes it over once that tab closes.
      if (error instanceof ShareOpenInAnotherTabError) {
        void ports.logger.log("INFO", LOG_MODULE, "A shared project runs in another tab; this tab waits for it", { folder: project.folder, shareId });
        return;
      }
      void ports.logger.error(LOG_MODULE, error, { action: "reconnect a shared project", folder: project.folder, shareId });
      reports.failed(project, error);
    });
  }
}

async function resume(ports: ShareFlowPorts, project: SharedProject, reports: ResumeReports, reported: Set<string>): Promise<void> {
  const shareId = project.settings.shared;
  await ports.shares.hold(shareId, async () => {
    const stored = await ports.keys.invite(shareId);
    if (!stored) {
      reported.add(shareId);
      void ports.logger.log("WARN", LOG_MODULE, "A shared project has no stored key on this device", { folder: project.folder, shareId });
      reports.missingKey(project);
      return;
    }
    ports.shares.add(await ports.connect(stored, { mode: "resume", folder: project.folder }));
    void ports.logger.log("INFO", LOG_MODULE, "Resumed a shared project", { folder: project.folder, shareId });
  });
}
