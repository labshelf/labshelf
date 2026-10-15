/**
 * Background entry (MV3 service worker in Chrome, non-persistent background script in Firefox). Wires Drive auth, the
 * sync coordinator and its triggers, capture and the toolbar badge into the runtime message channel that the popup,
 * options, library page and Google Scholar buttons use.
 */
import { bx } from "../platform/browserApi";
import { BrowserLogger } from "../platform/logger";
import { BrowserDriveAuth } from "../sync/auth/browserDriveAuth";
import { createBrowserSync } from "../sync";
import { createLibraryMutations, rebuildFromFiles } from "../storage";
import { forgetDraft } from "./draftCache";
import { installAutoSyncScheduler } from "./autoSyncScheduler";
import { installIdleSyncTrigger } from "./syncOnIdle";
import { createSyncMessages } from "./syncMessages";
import { AlarmSyncTimers } from "./alarmSyncTimers";
import { installBadgeUpdater } from "./badgeUpdater";
import { broadcastChanged } from "./broadcast";
import { registerMessageRouter } from "./router";

const log = new BrowserLogger("background");
const mutations = createLibraryMutations(log);
const auth = new BrowserDriveAuth();
const timers = new AlarmSyncTimers(log);
const sync = createBrowserSync({
  auth,
  logger: log,
  timers,
  onSynced: async () => {
    await rebuildFromFiles();
    // A sync may have downloaded PDFs; let open pages refresh presence.
    broadcastChanged("sync");
  },
});
timers.listen((id) => { void sync.onTimer(id); });
void sync.init();

const syncMessages = createSyncMessages(auth, sync, log);
const scheduleSync = syncMessages.scheduleSoon;

void installAutoSyncScheduler({ sync, logger: log });
installIdleSyncTrigger({ trigger: syncMessages.trigger, logger: log });
installBadgeUpdater(syncMessages.snapshot);

registerMessageRouter({ log, mutations, syncMessages, scheduleSync });

bx.runtime.onInstalled.addListener((details) => {
  void log.info("extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.info("browser startup");
});

bx.tabs.onRemoved.addListener((tabId) => forgetDraft(tabId));
