/**
 * Keeps the periodic sync interval in step with the autoSyncMinutes setting, so an edit in the options page takes
 * effect without an extension reload.
 */
import { SETTINGS_STORAGE_KEY, bx, getSettings, type BrowserLogger } from "../platform";

export interface AutoSyncSchedulerOptions {
  sync: { startPeriodic(minutes: number): void };
  logger: BrowserLogger;
}

/** Applies the interval now and whenever the setting changes. */
export async function installAutoSyncScheduler(opts: AutoSyncSchedulerOptions): Promise<void> {
  await applyInterval(opts);
  bx.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!(SETTINGS_STORAGE_KEY in changes)) return;
    void applyInterval(opts);
  });
}

async function applyInterval({ sync, logger }: AutoSyncSchedulerOptions): Promise<void> {
  const { autoSyncMinutes } = await getSettings();
  sync.startPeriodic(autoSyncMinutes);
  await logger.info(autoSyncMinutes > 0 ? "auto-sync scheduled" : "auto-sync disabled", { autoSyncMinutes });
}
