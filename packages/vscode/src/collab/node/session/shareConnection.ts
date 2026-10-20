// Connects this device to one shared project: its stored state, the peer session over its relay, presence, blobs and the disk mirror.
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  attachAwareness, attachBlobs, COMMENTS_PATH, createShareSession, createSwitchableTransport, deriveAwarenessKey,
  deriveContentKey, deriveRelayToken, importCommentsFile, indexSettings, joinShare, openCollabStore, readIndexKind, startShare,
  type CollabStore, type ILogger, type InviteRelay, type PresenceHandle, type ShareSession,
} from "@labshelf/core";
import {
  deviceLocalLayout, nodeCollabStorage, nodeProjectCatalogContext, startProjectMirror, type ProjectMirror,
} from "@labshelf/core/node";
import { followShareRelays, type ShareRelays } from "./shareRelays.js";

const JOIN_TIMEOUT_MS = 120_000;

export interface ShareConnection {
  readonly shareId: string;
  readonly shareKey: Uint8Array;
  /** The project folder, absolute. */
  readonly folder: string;
  readonly session: ShareSession;
  readonly presence: PresenceHandle;
  readonly mirror: ProjectMirror;
  /** The relays the share syncs through, one at a time. */
  readonly relays: ShareRelays;
  close(): Promise<void>;
}

/** `share` turns a project into a share, `resume` reconnects a shared one, `join` creates the project of a share in the library. */
export type ShareStart = { mode: "share" | "resume"; folder: string } | { mode: "join"; signal: AbortSignal };

export interface ConnectOptions {
  libraryRoot: string;
  shareId: string;
  shareKey: Uint8Array;
  /** The invite's relays, tried while the index lists none. */
  relays: readonly InviteRelay[];
  logger: ILogger;
  /** True for a path of the folder an open editor holds. */
  isEditorOwned(folder: string, path: string): boolean;
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

async function connectSession(options: ConnectOptions, store: CollabStore, start: ShareStart): Promise<ShareConnection> {
  const { shareId, shareKey, logger } = options;
  const contentKey = await deriveContentKey(shareKey);
  // CONTRACT: documents/contracts/collaboration.md#share-key — every relay of the share takes the token the share key derives.
  const relayToken = await deriveRelayToken(shareKey);
  const inviteRelays = options.relays.map((relay) => relay.url);
  const slot = createSwitchableTransport();
  const session = createShareSession({ shareId, contentKey, transport: slot, logger, index: store.index, createDoc: store.createDoc });
  // TRAP: a peer sends its presence once, when this device appears, which during a join is before the project exists.
  // A channel attached after that would drop it as an unknown kind.
  const awarenessKey = await deriveAwarenessKey(shareKey);
  const presence = attachAwareness(session, { awarenessKey, logger });
  const relays = followShareRelays({
    session, slot, presence, inviteRelays, shareId, relayToken, contentKey, awarenessKey, cursorsFor: store.relayCursors, logger,
  });
  const blobs = attachBlobs(session, {
    contentKey, getBlob: (hash) => store.blobs.get(hash), logger, skipPeer: (peer) => presence.reportsOtherRelay(peer),
  });
  try {
    const folder = await placeProject(options, session, start);
    const mirror = startProjectMirror({ folder, session, blobs, store, logger, isEditorOwned: (file) => options.isEditorOwned(folder, file) });
    // A joiner opens the project right after this returns, so the files already on hand must be on disk first.
    if (start.mode === "join") { await mirror.idle(); }
    return {
      shareId, shareKey, folder, session, presence, mirror, relays,
      close: async () => {
        await presence.close();
        // The mirror waits for blob fetches in flight, so the exchange closes first.
        blobs.close();
        await mirror.close();
        // The relay sync puts its last updates over the relay socket before the session closes.
        await relays.close();
        await session.close();
        await store.close();
      },
    };
  } catch (error) {
    await presence.close();
    blobs.close();
    await relays.close();
    await session.close();
    throw error;
  }
}

export async function connectShare(options: ConnectOptions, start: ShareStart): Promise<ShareConnection> {
  const dir = path.join(deviceLocalLayout(options.libraryRoot).collabDir, options.shareId);
  const store = await openCollabStore({ storage: nodeCollabStorage({ dir, shareId: options.shareId }), logger: options.logger });
  try {
    return await connectSession(options, store, start);
  } catch (error) {
    // The connect error is the one to surface; a state that failed to store is logged beside it.
    await store.close().catch((closeError: unknown) =>
      options.logger.error("collab.share", closeError, { shareId: options.shareId, action: "close share state" }));
    throw error;
  }
}
