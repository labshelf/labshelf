// Drives the header sync button: state at a glance (connected/syncing/error), click syncs now or opens settings.
import { $, shortTime } from "@labshelf/core/dom";
import { icon } from "@labshelf/core";

import type { SyncStatusData } from "../platform";
import { send } from "./runtimeSend";

export async function renderSync(): Promise<void> {
  const btn = $<HTMLButtonElement>("sync");
  try {
    const [auth, sync] = await Promise.all([
      send<{ connected: boolean }>({ type: "auth.status" }),
      send<SyncStatusData>({ type: "sync.status" }),
    ]);
    btn.classList.toggle("spinning", sync.syncing);
    btn.dataset["tone"] = sync.lastError ? "error" : "";
    if (!auth.connected) {
      btn.innerHTML = icon("cloud-off");
      btn.title = "Not syncing — connect Google Drive in Settings";
      btn.dataset["action"] = "connect";
    } else {
      btn.innerHTML = icon(sync.syncing ? "refresh" : sync.lastError ? "warning" : "cloud");
      btn.title = sync.syncing ? "Syncing…"
        : sync.lastError ? `Sync failed — ${sync.lastError}. Click to retry.`
        : `Synced with Google Drive${sync.lastSyncTime ? ` ${shortTime(sync.lastSyncTime)}` : ""}. Click to sync now.`;
      btn.dataset["action"] = "sync";
    }
  } catch {
    btn.innerHTML = icon("cloud-off");
    btn.title = "Background unavailable";
  }
}
