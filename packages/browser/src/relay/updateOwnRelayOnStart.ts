// Brings the owner's deployed relay up to the bundled Worker build when an extension page starts.
import { readRelayWorkerScript, systemRelayClock, updateOwnRelay, type ILogger } from "@labshelf/core";
import { openBrowserRelayAccountStore } from "./browserRelayAccountStore";

const LOG_MODULE = "relay";
const UPDATE_LOCK = "labshelf:relay-account:update";

export async function updateOwnRelayOnStart(logger: ILogger): Promise<void> {
  try {
    await navigator.locks.request(UPDATE_LOCK, { ifAvailable: true }, async (lock) => {
      // Another page holds the lock and does the same check.
      if (!lock) { return; }
      await updateOwnRelay({
        store: openBrowserRelayAccountStore(logger),
        // PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome.
        fetch: (input, init) => globalThis.fetch(input, init),
        logger, clock: systemRelayClock, script: readRelayWorkerScript(),
        // A start-up check never opens a consent tab the owner did not ask for; a refused sign-in surfaces at the next connect or share.
        signInAgain: async () => false,
      });
    });
  } catch (error) {
    await logger.error(LOG_MODULE, error, { step: "update the owner's relay on start" });
  }
}
