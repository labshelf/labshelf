// Declares what an app hands the share workflows: where keys live, its connected shares, its project list and how it connects.
import type { ILogger } from "../../../ports/index.js";
import type { RelayAccount } from "../../../relay/account/index.js";
import type { ProjectEntry, ProjectReadContext } from "../../../writing/project/index.js";
import type { Invite } from "../../invite/index.js";
import type { ShareConnection, ShareStart } from "../../session/index.js";

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
