// Opens the owner's Cloudflare connection, kept in VS Code's SecretStorage, and shows a progress notification on the first report of a relay step.
import * as vscode from "vscode";

import {
  createRelayAccountStore, createStoredLock, type ILogger, type RelayAccountStore, type RelayClock, type RelayLock, type StoredSecret, systemRelayClock,
} from "@labshelf/core";

export const LOG_MODULE = "relay";
const ACCOUNT_SECRET = "labshelf.relay.account";
const OAUTH_TOKENS_SECRET = "labshelf.relay.cloudflareTokens";
const REFRESH_LOCK_SECRET = "labshelf.relay.cloudflareRefreshLock";
const LIFECYCLE_LOCK_SECRET = "labshelf.relay.lifecycleLock";
/** The stored lock frees a holder that has not written for 30 s, and a deploy takes minutes; the holder rewrites its stamp this often. */
export const LOCK_RENEW_MS = 10_000;

function slot(secrets: vscode.SecretStorage, name: string): StoredSecret {
  return {
    get: async () => secrets.get(name),
    store: async (value) => secrets.store(name, value),
    delete: async () => secrets.delete(name),
  };
}

export function openRelayAccounts(secrets: vscode.SecretStorage, logger: ILogger): RelayAccountStore {
  const store = createRelayAccountStore({
    account: slot(secrets, ACCOUNT_SECRET),
    tokens: slot(secrets, OAUTH_TOKENS_SECRET),
    refreshLock: createStoredLock(slot(secrets, REFRESH_LOCK_SECRET), systemRelayClock),
  }, logger);
  // The refresh lock lives in its own secret, which the core store does not know.
  return { ...store, forget: async () => { await store.forget(); await secrets.delete(REFRESH_LOCK_SECRET); } };
}

function readLockOwner(text: string | undefined): string | undefined {
  try {
    const owner = (JSON.parse(text ?? "null") as { owner?: unknown } | null)?.owner;
    return typeof owner === "string" ? owner : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the lock's stamp fresh while `run` holds it, so a long deploy is not taken for a crashed holder. */
async function renewWhileHeld(slot: StoredSecret, clock: RelayClock): Promise<() => Promise<void>> {
  const owner = readLockOwner(await slot.get());
  if (!owner) { return async () => undefined; }
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing) { return; }
    renewing = (async () => {
      // Only while the lock is still ours: a holder that lost it must not take it back.
      if (readLockOwner(await slot.get()) === owner) { await slot.store(JSON.stringify({ owner, at: clock.now() })); }
    })().catch(() => undefined).finally(() => { renewing = undefined; });
  }, LOCK_RENEW_MS);
  return async () => {
    clearInterval(timer);
    // A write still in flight would otherwise land after the release and leave the lock held.
    await renewing;
  };
}

/** A lock that one window at a time holds across the extension hosts, kept fresh while a long relay change runs. */
export function createRenewingLock(slot: StoredSecret, clock: RelayClock): RelayLock {
  const lock = createStoredLock(slot, clock);
  return (run) => lock.run(async () => {
    const stop = await renewWhileHeld(slot, clock);
    try {
      return await run();
    } finally {
      await stop();
    }
  });
}

/** The lock the start-up update, the retirement and the rotation of the relay run under. */
export function openRelayLifecycleLock(secrets: vscode.SecretStorage): RelayLock {
  return createRenewingLock(slot(secrets, LIFECYCLE_LOCK_SECRET), systemRelayClock);
}

export interface LazyProgress {
  report(message: string): void;
  close(): void;
}

/** A relay step that never reports shows nothing, so a cancelled choice leaves no notification behind. */
export function createLazyProgress(title: string): LazyProgress {
  let sink: vscode.Progress<{ message?: string }> | undefined;
  let latest = "";
  let release = (): void => undefined;
  const closed = new Promise<void>((resolve) => { release = resolve; });
  return {
    report(message) {
      latest = message;
      if (sink) { sink.report({ message }); return; }
      void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, async (progress) => {
        sink = progress;
        progress.report({ message: latest });
        await closed;
      });
    },
    close: () => release(),
  };
}
