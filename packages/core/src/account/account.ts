// Describes the Account tab: what it shows, the port it acts through, the port a host builds from its own stores, and the messages that carry the port across a webview.
import type { MessageEnd } from "../libraryUi/protocol/transport.js";
import type { ILogger } from "../ports/index.js";

export interface AccountState {
  userName: string;
  /** False while this app cannot connect Cloudflare yet; the tab then shows the buttons disabled. */
  cloudflareAvailable: boolean;
  /** The connected relay's address, never a secret; undefined when Cloudflare is not connected. */
  relayUrl: string | undefined;
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
}

/** What the Account view reads and runs; each host implements it over its own stores and flows. */
export interface AccountPort {
  /** Calls `listener` with the state once it is read, then after each change; returns what stops it. */
  watch(listener: (state: AccountState) => void): () => void;
  saveUserName(name: string): Promise<void>;
  connectCloudflare(): Promise<void>;
  disconnectCloudflare(): Promise<void>;
  setRemoteAccess(on: boolean): Promise<void>;
}

/** The remote access of an app that can serve its library to a browser; it reports its own value and the failure of a change. */
export interface AccountRemote {
  read(): Promise<{ on: boolean }>;
  set(on: boolean): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** The Cloudflare connection of an app that can connect one; its flows confirm and report their own failures. */
export interface AccountCloudflare {
  status(): Promise<{ relayUrl: string } | undefined>;
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

/** What the last remote access change left on screen: busy while it runs, its failure message until the next action. */
interface RemoteChange { busy: boolean; message: string | undefined }

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
  return { userName, cloudflareAvailable: cloudflare !== undefined, relayUrl, remoteAccess };
}

/** Turns remote access on or off, showing the tab busy meanwhile and keeping a failure's message; refreshes before and after. */
async function changeRemoteAccess(host: AccountHost, change: RemoteChange, on: boolean, refresh: () => Promise<void>): Promise<void> {
  const remote = host.remoteAccess?.();
  if (!remote) return;
  change.busy = true;
  change.message = undefined;
  await refresh();
  try {
    const result = await remote.set(on);
    if (!result.ok) change.message = result.message;
  } catch (error) {
    await host.logger?.error(LOG_MODULE, error, { action: "set remote access" });
    change.message = "Could not change remote access";
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
    setRemoteAccess: (on) => changeRemoteAccess(host, change, on, refresh),
    refresh,
  };
}

// ---- Webview messages
export type AccountToHost =
  | { type: "account.ready" }
  | { type: "account.saveUserName"; name: string }
  | { type: "account.connect" }
  | { type: "account.disconnect" }
  | { type: "account.setRemoteAccess"; on: boolean };

export type HostToAccount = { type: "account.state"; state: AccountState };

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
    }
  });
  return () => { stop(); stopWatch?.(); };
}

/**
 * The view side of `serveAccount`: actions resolve once they are sent, and the state the host posts afterwards updates the view.
 * Each `watch` asks the host for the state again.
 */
export function createAccountClient(end: MessageEnd<AccountToHost, HostToAccount>): AccountPort {
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
  };
}
