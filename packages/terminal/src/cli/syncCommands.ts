// `labshelf sync` and `labshelf auth`: drives one Drive sync and manages the Google sign-in used for it.
import { relativeTime } from "@labshelf/core";

import type { AppContext } from "../app/index.js";
import { openExternal } from "../platform/index.js";
import type { Output } from "./usage.js";
import { UsageError } from "./usage.js";

export async function runSync(ctx: AppContext, io: Output, json: boolean): Promise<number> {
  const outcome = await ctx.sync.syncNow("cli");
  if (json) {
    io.out(JSON.stringify(outcome.kind === "synced" ? { kind: "synced", ...outcome.record } : outcome, null, 2));
  } else if (outcome.kind === "synced") {
    const r = outcome.record;
    io.out(`synced: ${r.downloaded} downloaded, ${r.uploaded} uploaded, ${r.deletedLocal} removed here, ${r.deletedRemote} removed on Drive`);
    for (const conflict of r.conflicts) { io.err(`conflict: ${conflict} (both versions kept)`); }
  } else if (outcome.kind === "busy") {
    io.err(`${outcome.holder?.app === "vscode" ? "VS Code" : "Another LabShelf app"} is syncing this library right now.`);
  } else if (outcome.kind === "skipped") {
    io.err(`sync skipped: ${outcome.reason}${outcome.reason.includes("signed in") ? " — run `labshelf auth login`" : ""}`);
  } else {
    io.err(`sync failed: ${outcome.error}`);
  }
  return outcome.kind === "synced" ? 0 : 1;
}

export async function runAuth(ctx: AppContext, sub: string | undefined, io: Output): Promise<number> {
  if (sub === "login") {
    await ctx.drive.login({
      openBrowser: (url) => openExternal(url),
      onUrl: (url) => io.err(`Opening Google sign-in in your browser. If nothing opens, visit:\n\n  ${url}\n`),
    });
    io.out("Signed in to Google Drive.");
    return 0;
  }
  if (sub === "logout") {
    await ctx.drive.logout();
    io.out("Signed out. The library stays on this computer.");
    return 0;
  }
  if (sub === "status" || sub === undefined) {
    const status = ctx.sync.status();
    io.out(`drive:     ${status.state === "unconfigured" ? "no OAuth client configured" : status.state === "disconnected" ? "signed out" : "signed in"}`);
    io.out(`last sync: ${status.lastRun ? `${relativeTime(status.lastRun.finishedAt) || "never"} by ${status.lastRun.app} on ${status.lastRun.host}` : "never"}`);
    return 0;
  }
  throw new UsageError("Usage: labshelf auth login | logout | status");
}
