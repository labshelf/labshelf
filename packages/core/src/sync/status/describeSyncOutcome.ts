// Words the result of one sync run once, for every app that reports it; apps decide where to show it.
import { SKIP_NOT_SIGNED_IN, type SyncOutcome } from "../coordinator/index.js";
import type { SyncRunRecord } from "../engine/index.js";

export interface SyncNotice {
  text: string;
  severity: "info" | "warn" | "error";
  /** One line per file kept as a conflict copy. */
  details: string[];
  /** Nothing needs the user's attention (unchanged library, another app syncing, signed out): show it only for a sync they asked for. */
  routine: boolean;
  /** The run needs a Google sign-in; the app appends how to do it. */
  needsSignIn: boolean;
}

const APP_NAMES: Record<string, string> = { vscode: "VS Code", terminal: "The LabShelf terminal app" };

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** @returns the notice for an outcome, in the sentence every app shows */
export function describeSyncOutcome(outcome: SyncOutcome): SyncNotice {
  const base = { details: [], routine: false, needsSignIn: false };
  switch (outcome.kind) {
    case "synced": return describeSynced(outcome.record);
    case "busy": {
      const who = APP_NAMES[outcome.holder?.app ?? ""] ?? "Another LabShelf app";
      return { ...base, text: `${who} is syncing this library right now; its changes will show up here`, severity: "warn", routine: true };
    }
    case "skipped":
      return { ...base, text: `Sync skipped: ${outcome.reason}`, severity: "warn", routine: true, needsSignIn: outcome.reason === SKIP_NOT_SIGNED_IN };
    // The error of a rejected sign-in already carries the app's own sign-in hint.
    case "failed": return { ...base, text: `Sync failed: ${outcome.error}`, severity: "error" };
  }
}

function describeSynced(r: SyncRunRecord): SyncNotice {
  const moved = [
    r.downloaded && `${r.downloaded} downloaded`,
    r.uploaded && `${r.uploaded} uploaded`,
    r.deletedLocal && `${r.deletedLocal} removed here`,
    r.deletedRemote && `${r.deletedRemote} removed on Drive`,
  ].filter(Boolean);
  const base = { needsSignIn: false };
  if (r.conflicts.length) {
    return {
      ...base,
      text: `Synced with ${plural(r.conflicts.length, "conflict")}: both versions kept, the remote one renamed "(conflict …)"`,
      severity: "warn",
      details: r.conflicts.map((path) => `conflict: ${path}`),
      routine: false,
    };
  }
  return { ...base, text: moved.length ? `Synced: ${moved.join(", ")}` : "Already in sync", severity: "info", details: [], routine: !moved.length };
}
