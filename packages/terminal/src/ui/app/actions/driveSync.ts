/** Runs manual sync (the sync key and :sync), reports the result it leaves in the status bar, and signing in to Google Drive. */
import { describeSyncOutcome, type SyncOutcome } from "@labshelf/core";

import { copyToClipboard, openExternal } from "../../../platform/index.js";
import type { App } from "../app.js";

export function appName(app: string | undefined): string {
  if (app === "vscode") { return "VS Code"; }
  if (app === "terminal") { return "Another terminal session"; }
  return "Another app";
}

export async function syncNow(app: App): Promise<void> {
  const status = app.ctx.sync.status();
  if (status.state === "unconfigured") {
    app.taskStatus.notify("Drive sync needs the VS Code extension's OAuth client (see labshelf doctor)", "error");
    return;
  }
  if (status.state === "disconnected") { app.taskStatus.notify("Not signed in to Google Drive — run :login", "warn"); return; }
  reportSync(app, await app.ctx.sync.syncNow("manual"), false);
}

export function reportSync(app: App, outcome: SyncOutcome, quiet: boolean): void {
  const notice = describeSyncOutcome(outcome);
  if (quiet && notice.routine) { return; }
  app.taskStatus.notify(notice.needsSignIn ? `${notice.text} — run :login` : notice.text, notice.severity);
}

export async function login(app: App): Promise<void> {
  await app.taskStatus.task("auth", "waiting for Google sign-in", async () => {
    await app.ctx.drive.login({
      openBrowser: (url) => openExternal(url),
      onUrl: (url) => {
        void copyToClipboard(url, (seq) => app.term.writeRaw(seq));
        app.taskStatus.notify("Sign in in the browser that just opened (the link is also on your clipboard)");
        app.render();
      },
    });
    app.taskStatus.notify("Connected to Google Drive — syncing…");
    app.render();
    reportSync(app, await app.ctx.sync.syncNow("login"), false);
  });
}
