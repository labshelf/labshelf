// Wires Drive auth, sync, capture and the badge into the runtime message channel the UI pages use.
// Runs as an MV3 service worker in Chrome and a non-persistent background script in Firefox.
import { bx, createBrowserLogger } from "../platform";
import { BrowserDriveAuth } from "../sync/auth";
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

const log = createBrowserLogger();
const MODULE = "background";
const mutations = createLibraryMutations(log);
const auth = new BrowserDriveAuth(log);
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
  void log.log("INFO", MODULE, "extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.log("INFO", MODULE, "browser startup");
});

bx.tabs.onRemoved.addListener((tabId) => forgetDraft(tabId));
