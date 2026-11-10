// Describes the Account tab: what it shows, the port it acts through, the port a host builds from its own stores, and the messages that carry the port across a webview.
import type { MessageEnd } from "../libraryUi/protocol/index.js";
import type { ILogger } from "../ports/index.js";

export interface AccountState {
  userName: string;
  /** False while this app cannot connect Cloudflare yet; the tab then shows the buttons disabled. */
  cloudflareAvailable: boolean;
  /** The connected relay's address, never a secret; undefined when Cloudflare is not connected. */
  relayUrl: string | undefined;
  /** The Cloudflare account's email; known only after a sign-in, not with a pasted token. */
  cloudflareEmail?: string;
  remoteAccess: AccountRemoteAccess;
}

/** The remote access switch: available only when the app can serve it and Cloudflare is connected. */
export interface AccountRemoteAccess {
  available: boolean;
  on: boolean;
  /** True from the toggle until the host settles it. */
  busy: boolean;
  /** Why the last toggle failed; shown until the next action. */
  message?: string;
  /** The store, its use and the last sync's outcome; present only while remote access is on and the host can read them. */
  details?: AccountRemoteDetails;
}

/** Where the remote library is stored, how full it is and what the last sync left out. */
export interface AccountRemoteDetails {
  store: "do" | "r2";
  used: number;
  limit: number;
  includePdfs: boolean;
  r2Bound: boolean;
  warn: boolean;
  full: boolean;
  /** From the last sync result the host keeps; empty before any run. */
  leftOut: string[];
}

export type AccountActionResult = { ok: true } | { ok: false; message: string };

/** What including the paper PDFs would add to the remote library. */
export interface PaperPdfsEstimate { bytes: number; files: number }

/** What the Account view reads and runs; each host implements it over its own stores and flows. */
export interface AccountPort {
  /** Calls `listener` with the state once it is read, then after each change; returns what stops it. */
  watch(listener: (state: AccountState) => void): () => void;
  saveUserName(name: string): Promise<void>;
  connectCloudflare(): Promise<void>;
  disconnectCloudflare(): Promise<void>;
  setRemoteAccess(on: boolean): Promise<void>;
  /** Rejects with the message to show when the host cannot tell. */
  estimatePaperPdfs(): Promise<PaperPdfsEstimate>;
  setIncludePdfs(on: boolean): Promise<void>;
  /** Null goes back to the store's default limit. */
  setStorageLimit(bytes: number | null): Promise<void>;
  moveStore(store: "do" | "r2"): Promise<void>;
}

/** The remote access of an app that can serve its library to a browser; it reports its own value and the failure of a change. */
export interface AccountRemote {
  read(): Promise<{ on: boolean }>;
  set(on: boolean): Promise<AccountActionResult>;
  /** Undefined when remote access is off or the relay cannot be reached. */
  details(): Promise<AccountRemoteDetails | undefined>;
  estimatePaperPdfs(): Promise<PaperPdfsEstimate>;
  setIncludePdfs(on: boolean): Promise<AccountActionResult>;
  setLimit(bytes: number | null): Promise<AccountActionResult>;
  /** R2 binds the bucket first; Durable Object moves back, then unbinds it. */
  moveStore(store: "do" | "r2"): Promise<AccountActionResult>;
}

/** The Cloudflare connection of an app that can connect one; its flows confirm and report their own failures. */
export interface AccountCloudflare {
  /** `email` is known only after a sign-in. */
  status(): Promise<{ relayUrl: string; email?: string } | undefined>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface AccountHost {
  readUserName(): Promise<string>;
  writeUserName(name: string): Promise<void>;
  /** Undefined while this app cannot connect Cloudflare yet. */
  cloudflare(): AccountCloudflare | undefined;
  /** Undefined while this app has no remote access. */
  remoteAccess?: (() => AccountRemote | undefined) | undefined;
  logger?: ILogger;
}

export interface AccountSource extends AccountPort {
  /** Reads the state again and tells the watchers, e.g. when the tab is shown again after a change made elsewhere. */
  refresh(): Promise<void>;
}

const LOG_MODULE = "account";
const ESTIMATE_FAILURE = "Could not estimate the size of the paper PDFs";

/** What the last remote access action left on screen: busy while it runs, its failure message until the next action. */
interface RemoteChange { busy: boolean; message: string | undefined }

/** Reads the remote library's details; a failure only leaves them out. */
async function readDetails(host: AccountHost, remote: AccountRemote): Promise<AccountRemoteDetails | undefined> {
  try {
    return await remote.details();
  } catch (error) {
    await host.logger?.error(LOG_MODULE, error, { action: "read remote access details" });
    return undefined;
  }
}

/** Reads the user name, the Cloudflare state and the remote access state together. */
async function readAccountState(host: AccountHost, change: RemoteChange): Promise<AccountState> {
  const cloudflare = host.cloudflare();
  const remote = host.remoteAccess?.();
  const [userName, status, remoteValue] = await Promise.all([
    host.readUserName(),
    cloudflare ? cloudflare.status() : Promise.resolve(undefined),
    remote ? remote.read() : Promise.resolve(undefined),
  ]);
  const relayUrl = status?.relayUrl;
  const remoteAccess: AccountRemoteAccess = { available: remote !== undefined && relayUrl !== undefined, on: remoteValue?.on ?? false, busy: change.busy };
  if (change.message !== undefined) remoteAccess.message = change.message;
  const details = remote && remoteAccess.available && remoteAccess.on ? await readDetails(host, remote) : undefined;
  if (details) remoteAccess.details = details;
  const state: AccountState = { userName, cloudflareAvailable: cloudflare !== undefined, relayUrl, remoteAccess };
  if (status?.email) state.cloudflareEmail = status.email;
  return state;
}

/** Runs one remote access action, showing the tab busy meanwhile and keeping a failure's message; refreshes before and after. */
async function runRemoteAction(
  host: AccountHost, change: RemoteChange, refresh: () => Promise<void>, failure: string, run: (remote: AccountRemote) => Promise<AccountActionResult>,
): Promise<void> {
  const remote = host.remoteAccess?.();
  if (!remote) return;
  change.busy = true;
  change.message = undefined;
  await refresh();
  try {
    const result = await run(remote);
    if (!result.ok) change.message = result.message;
  } catch (error) {
    await host.logger?.error(LOG_MODULE, error, { action: failure });
    change.message = `Could not ${failure}`;
  } finally {
    change.busy = false;
    await refresh();
  }
}

/** Builds the Account port from a host's stores; the state is read again after every action. */
export function createAccountSource(host: AccountHost): AccountSource {
  const listeners = new Set<(state: AccountState) => void>();
  let last: AccountState | undefined;
  const change: RemoteChange = { busy: false, message: undefined };
  const refresh = async (): Promise<void> => {
    try {
      last = await readAccountState(host, change);
      for (const listener of [...listeners]) listener(last);
    } catch (error) {
      await host.logger?.error(LOG_MODULE, error, { action: "read the account" });
    }
  };
  const remoteAction = (failure: string, run: (remote: AccountRemote) => Promise<AccountActionResult>): Promise<void> =>
    runRemoteAction(host, change, refresh, failure, run);
  const afterwards = async (action: () => Promise<void>): Promise<void> => {
    try { await action(); } finally { await refresh(); }
  };
  return {
    watch(listener) {
      listeners.add(listener);
      if (last) listener(last);
      else void refresh();
      return () => { listeners.delete(listener); };
    },
    saveUserName: (name) => afterwards(() => host.writeUserName(name)),
    connectCloudflare: () => afterwards(async () => { await host.cloudflare()?.connect(); }),
    disconnectCloudflare: () => afterwards(async () => { await host.cloudflare()?.disconnect(); }),
    setRemoteAccess: (on) => remoteAction("change remote access", (remote) => remote.set(on)),
    estimatePaperPdfs: async () => {
      try {
        const remote = host.remoteAccess?.();
        if (remote) return await remote.estimatePaperPdfs();
      } catch (error) {
        await host.logger?.error(LOG_MODULE, error, { action: "estimate paper PDFs" });
      }
      throw new Error(ESTIMATE_FAILURE);
    },
    setIncludePdfs: (on) => remoteAction("change paper PDFs", (remote) => remote.setIncludePdfs(on)),
    setStorageLimit: (bytes) => remoteAction("save the limit", (remote) => remote.setLimit(bytes)),
    moveStore: (store) => remoteAction("move the remote library", (remote) => remote.moveStore(store)),
    refresh,
  };
}

// ---- Webview messages
export type AccountToHost =
  | { type: "account.ready" }
  | { type: "account.saveUserName"; name: string }
  | { type: "account.connect" }
  | { type: "account.disconnect" }
  | { type: "account.setRemoteAccess"; on: boolean }
  | { type: "account.estimatePaperPdfs"; id: number }
  | { type: "account.setIncludePdfs"; on: boolean }
  | { type: "account.setStorageLimit"; bytes: number | null }
  | { type: "account.moveStore"; store: "do" | "r2" };

/** `account.paperPdfs` answers `account.estimatePaperPdfs` with the same id: the estimate, or the message to show. */
export type HostToAccount =
  | { type: "account.state"; state: AccountState }
  | { type: "account.paperPdfs"; id: number; estimate?: PaperPdfsEstimate; message?: string };

/** Answers an Account view across a message channel; returns what stops answering. */
export function serveAccount(end: MessageEnd<HostToAccount, AccountToHost>, port: AccountPort): () => void {
  let stopWatch: (() => void) | undefined;
  const stop = end.subscribe((message) => {
    switch (message.type) {
      case "account.ready":
        stopWatch?.();
        stopWatch = port.watch((state) => end.post({ type: "account.state", state }));
        return;
      case "account.saveUserName": void port.saveUserName(message.name); return;
      case "account.connect": void port.connectCloudflare(); return;
      case "account.disconnect": void port.disconnectCloudflare(); return;
      case "account.setRemoteAccess": void port.setRemoteAccess(message.on); return;
      case "account.estimatePaperPdfs": {
        const { id } = message;
        port.estimatePaperPdfs().then(
          (estimate) => end.post({ type: "account.paperPdfs", id, estimate }),
          (error: unknown) => end.post({ type: "account.paperPdfs", id, message: error instanceof Error ? error.message : ESTIMATE_FAILURE }),
        );
        return;
      }
      case "account.setIncludePdfs": void port.setIncludePdfs(message.on); return;
      case "account.setStorageLimit": void port.setStorageLimit(message.bytes); return;
      case "account.moveStore": void port.moveStore(message.store); return;
    }
  });
  return () => { stop(); stopWatch?.(); };
}

/**
 * The view side of `serveAccount`: actions resolve once they are sent, and the state the host posts afterwards updates the view.
 * Each `watch` asks the host for the state again.
 */
export function createAccountClient(end: MessageEnd<AccountToHost, HostToAccount>): AccountPort {
  let lastId = 0;
  return {
    watch(listener) {
      const stop = end.subscribe((message) => { if (message.type === "account.state") listener(message.state); });
      end.post({ type: "account.ready" });
      return stop;
    },
    saveUserName: async (name) => { end.post({ type: "account.saveUserName", name }); },
    connectCloudflare: async () => { end.post({ type: "account.connect" }); },
    disconnectCloudflare: async () => { end.post({ type: "account.disconnect" }); },
    setRemoteAccess: async (on) => { end.post({ type: "account.setRemoteAccess", on }); },
    estimatePaperPdfs: () => new Promise((resolve, reject) => {
      const id = ++lastId;
      const stop = end.subscribe((message) => {
        if (message.type !== "account.paperPdfs" || message.id !== id) return;
        stop();
        if (message.estimate) resolve(message.estimate);
        else reject(new Error(message.message ?? ESTIMATE_FAILURE));
      });
      end.post({ type: "account.estimatePaperPdfs", id });
    }),
    setIncludePdfs: async (on) => { end.post({ type: "account.setIncludePdfs", on }); },
    setStorageLimit: async (bytes) => { end.post({ type: "account.setStorageLimit", bytes }); },
    moveStore: async (store) => { end.post({ type: "account.moveStore", store }); },
  };
}
