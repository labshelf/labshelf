/**
 * Draws the bottom status bar like VS Code's: the sync item on the left (cloud when connected, spinning while a sync
 * runs, cloud-off when disconnected; a click syncs now), the paper count, the theme toggle and settings on the right.
 */
import { icon } from "@labshelf/core";
import { $, el, shortTime, type ThemePref } from "@labshelf/core/dom";
import { bx, type SyncStatusData } from "../../platform";
import { cycleThemePref, onThemeChange } from "../../ui";
import type { SyncStatus } from "./syncStatus";

const THEME_LABEL: Record<ThemePref, string> = { auto: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

function renderSync(item: HTMLButtonElement, sync: SyncStatusData | null): void {
  item.classList.remove("error");
  if (!sync) { item.innerHTML = `${icon("cloud-off")}<span>LabShelf</span>`; item.title = "Sync status unavailable"; return; }
  if (sync.syncing) { item.innerHTML = `<span class="spin">${icon("refresh")}</span><span>LabShelf Sync</span>`; item.title = "Syncing with Google Drive…"; return; }
  if (sync.lastError) {
    item.classList.add("error");
    item.innerHTML = `${icon("warning")}<span>Sync failed</span>`;
    item.title = `${sync.lastError} — click to retry`;
    return;
  }
  if (!sync.connected) { item.innerHTML = `${icon("cloud-off")}<span>Not connected</span>`; item.title = "Connect to Google Drive in the LabShelf popup or settings"; return; }
  const when = sync.lastSyncTime ? ` (${shortTime(sync.lastSyncTime)})` : "";
  item.innerHTML = `${icon("cloud")}<span>LabShelf${when}</span>`;
  item.title = sync.lastSyncTime ? `Last synced ${new Date(sync.lastSyncTime).toLocaleString()} — click to sync now` : "Connected — click to sync now";
}

/** Builds the status bar and appends it to `host`; `onPaperCount` subscribes to the library's paper count. */
export function mountStatusBar(host: HTMLElement, sync: SyncStatus, onPaperCount: (listener: (count: number) => void) => () => void): () => void {
  const bar = el("footer", { class: "status-bar", html: `
    <div class="status-left">
      <button class="status-item clickable" id="syncItem" type="button" title="Sync with Google Drive now"></button>
    </div>
    <div class="status-right">
      <span class="status-item" id="countItem"></span>
      <button class="status-item clickable" id="themeItem" type="button"></button>
      <button class="status-item clickable" id="settingsItem" type="button" title="LabShelf settings">${icon("gear")}</button>
    </div>` });
  host.append(bar);
  const syncItem = $<HTMLButtonElement>("syncItem", bar);
  const themeItem = $<HTMLButtonElement>("themeItem", bar);
  syncItem.addEventListener("click", () => { void sync.syncNow(); });
  themeItem.addEventListener("click", () => cycleThemePref());
  $("settingsItem", bar).addEventListener("click", () => { void bx.runtime.openOptionsPage(); });
  const offs = [
    onThemeChange((theme, pref) => {
      themeItem.innerHTML = icon(theme === "dark" ? "moon" : "sun");
      themeItem.title = `${THEME_LABEL[pref]} — click to change`;
    }),
    sync.subscribe((s) => renderSync(syncItem, s)),
    onPaperCount((count) => { $("countItem", bar).textContent = `${count} paper${count === 1 ? "" : "s"}`; }),
  ];
  return () => offs.forEach((off) => off());
}
