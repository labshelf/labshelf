// Declares the options and handle of the relay sync that keeps a share session's docs on its relay.
import type { ILogger } from "../../ports/index.js";
import type { WebCryptoKey } from "../shareKey/index.js";
import type { RelayStore } from "../transport/index.js";
import type { SessionScheduler } from "../peer/index.js";
import type { RelayCursorStore } from "./relayCursors.js";

export interface RelaySyncOptions {
  relay: RelayStore;
  shareId: string;
  contentKey: WebCryptoKey;
  logger: ILogger;
  scheduler?: SessionScheduler;
  /** Defaults to memory, so every app start catches up from cursor 0. */
  cursors?: RelayCursorStore;
  /** True on the one connected client that writes snapshots, the one with the lowest awareness id, so the relay does not refuse copies at the same cursor. */
  isSnapshotWriter: () => boolean;
}

export interface RelaySync {
  /** Puts every pending update now. */
  flush(): Promise<void>;
  /** Flushes and stops; call it before closing the session, whose transport closes the socket. */
  close(): Promise<void>;
}
