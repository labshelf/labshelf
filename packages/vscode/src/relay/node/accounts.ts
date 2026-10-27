// Opens the owner's Cloudflare connection, kept in VS Code's SecretStorage, and shows a progress notification on the first report of a relay step.
import * as vscode from "vscode";

import { createRelayAccountStore, createStoredLock, type ILogger, type RelayAccountStore, type StoredSecret, systemRelayClock } from "@labshelf/core";

export const LOG_MODULE = "relay";
const ACCOUNT_SECRET = "labshelf.relay.account";
const OAUTH_TOKENS_SECRET = "labshelf.relay.cloudflareTokens";
const REFRESH_LOCK_SECRET = "labshelf.relay.cloudflareRefreshLock";

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
