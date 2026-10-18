// Connects this device to one shared project: its stored state, the peer session over the mesh and its relay, presence, blobs and the disk mirror.
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  attachAwareness, attachBlobs, attachRelaySync, COMMENTS_PATH, createShareSession, createTrysteroTransport, deriveAwarenessKey, deriveContentKey,
  importCommentsFile, indexSettings, joinShare, mergeTransports, readIndexKind, startShare, type ILogger, type InviteRelay, type PeerTransport,
  type PresenceHandle, type ShareSession,
} from "@labshelf/core";
import {
  deviceLocalLayout, loadNodeRTCPeerConnection, nodeProjectCatalogContext, openCollabStore, startProjectMirror, type CollabStore, type ProjectMirror,
} from "@labshelf/core/node";
import { chooseRelay, openShareRelay, type ShareRelay } from "./shareRelay.js";

const JOIN_TIMEOUT_MS = 120_000;

export interface ShareConnection {
  readonly shareId: string;
  readonly shareKey: Uint8Array;
  /** The project folder, absolute. */
  readonly folder: string;
  readonly session: ShareSession;
  readonly presence: PresenceHandle;
  readonly mirror: ProjectMirror;
  /** The relay the share syncs through besides the mesh, if its invite lists one. */
  readonly relayUrl: string | undefined;
  close(): Promise<void>;
}

/** `share` turns a project into a share, `resume` reconnects a shared one, `join` creates the project of a share in the library. */
export type ShareStart = { mode: "share" | "resume"; folder: string } | { mode: "join"; signal: AbortSignal };

export interface ConnectOptions {
  libraryRoot: string;
  shareId: string;
  shareKey: Uint8Array;
  /** The invite's relays; the share syncs through one of them. */
  relays: readonly InviteRelay[];
  logger: ILogger;
  /** True for a path of the folder an open editor holds. */
  isEditorOwned(folder: string, path: string): boolean;
}

let rtcPolyfill: ReturnType<typeof loadNodeRTCPeerConnection> | undefined;
function loadRtc(): ReturnType<typeof loadNodeRTCPeerConnection> {
  rtcPolyfill ??= loadNodeRTCPeerConnection().catch((error: unknown) => {
    rtcPolyfill = undefined;
    throw new Error(`WebRTC (node-datachannel) does not load on this device: ${String(error)}`);
  });
  return rtcPolyfill;
}

/** Resolves once peers synced the index far enough to name its kind and settings. */
function indexReady(session: ShareSession, signal: AbortSignal): Promise<void> {
  const ready = () => readIndexKind(session.index).ok && indexSettings(session.index).size > 0;
  if (ready()) { return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      session.index.off("update", onUpdate);
      signal.removeEventListener("abort", onAbort);
      if (error) { reject(error); } else { resolve(); }
    };
    const onUpdate = () => { if (ready()) { finish(); } };
    const onAbort = () => finish(new Error("Joining was cancelled"));
    const timer = setTimeout(() => finish(new Error("no member of the share answered in 2 minutes; ask one to open the project and try again")), JOIN_TIMEOUT_MS);
    session.index.on("update", onUpdate);
    signal.addEventListener("abort", onAbort);
  });
}

/** Seeds the share's comments map from the project's comments.json, which the map stands for from then on. */
async function importComments(folder: string, session: ShareSession, logger: ILogger): Promise<void> {
  let text: string;
  try {
    text = await readFile(path.join(folder, ...COMMENTS_PATH.split("/")), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return; }
    throw error;
  }
  const added = importCommentsFile(session.index, text);
  if (added === undefined) {
    void logger.log("WARN", "collab", "comments.json is not valid, so its threads are not shared", { folder, path: COMMENTS_PATH });
    return;
  }
  void logger.log("INFO", "collab", "Shared the project's comment threads", { folder, threads: added });
}

async function placeProject(options: ConnectOptions, session: ShareSession, start: ShareStart): Promise<string> {
  const context = nodeProjectCatalogContext(options.logger);
  if (start.mode !== "join") {
    if (start.mode === "share") {
      await startShare(context, { folder: start.folder, shareId: options.shareId, index: session.index });
      await importComments(start.folder, session, options.logger);
    }
    return start.folder;
  }
  await indexReady(session, start.signal);
  return (await joinShare(context, { libraryRoot: options.libraryRoot, shareId: options.shareId, index: session.index })).folder;
}

/** The mesh, merged with the relay when there is one. */
async function openTransport(options: ConnectOptions): Promise<{ transport: PeerTransport; relay: ShareRelay | undefined }> {
  const { shareId, shareKey, logger } = options;
  const chosen = chooseRelay(options.relays);
  const relay = chosen ? await openShareRelay(chosen, shareId, shareKey, logger) : undefined;
  try {
    const mesh = await createTrysteroTransport({ shareKey, logger, rtcPolyfill: await loadRtc(), ...(relay?.turnConfig ? { turnConfig: relay.turnConfig } : {}) });
    return { transport: relay ? mergeTransports(mesh, relay.transport) : mesh, relay };
  } catch (error) {
    await relay?.transport.close();
    throw error;
  }
}

async function connectSession(options: ConnectOptions, store: CollabStore, start: ShareStart): Promise<ShareConnection> {
  const { shareId, shareKey, logger } = options;
  const contentKey = await deriveContentKey(shareKey);
  const { transport, relay } = await openTransport(options);
  const session = createShareSession({ shareId, contentKey, transport, logger, index: store.index, createDoc: store.createDoc });
  const relaySync = relay && attachRelaySync(session, { relay: relay.transport, shareId, contentKey, logger, cursors: store.relayCursors });
  // TRAP: a peer sends its presence once, when this device appears, which during a join is before the project exists.
  // A channel attached after that would drop it as an unknown kind.
  const presence = attachAwareness(session, { awarenessKey: await deriveAwarenessKey(shareKey), logger });
  const blobs = attachBlobs(session, { contentKey, getBlob: (hash) => store.blobs.get(hash), logger });
  try {
    const folder = await placeProject(options, session, start);
    const mirror = startProjectMirror({ folder, session, blobs, store, logger, isEditorOwned: (file) => options.isEditorOwned(folder, file) });
    // A joiner opens the project right after this returns, so the files already on hand must be on disk first.
    if (start.mode === "join") { await mirror.idle(); }
    return {
      shareId, shareKey, folder, session, presence, mirror, relayUrl: relay?.url,
      close: async () => {
        await presence.close();
        // The mirror waits for blob fetches in flight, so the exchange closes first.
        blobs.close();
        await mirror.close();
        // The relay sync puts its last updates over the socket the session closes.
        await relaySync?.close();
        await session.close();
        await store.close();
      },
    };
  } catch (error) {
    await presence.close();
    blobs.close();
    await relaySync?.close();
    await session.close();
    throw error;
  }
}

export async function connectShare(options: ConnectOptions, start: ShareStart): Promise<ShareConnection> {
  const dir = path.join(deviceLocalLayout(options.libraryRoot).collabDir, options.shareId);
  const store = await openCollabStore({ dir, shareId: options.shareId, logger: options.logger });
  try {
    return await connectSession(options, store, start);
  } catch (error) {
    await store.close();
    throw error;
  }
}
