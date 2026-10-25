// Provides a logger that always writes to the library open at the time of the call.
import type { ILogger } from "@labshelf/core";
import type { LibraryRootController } from "./libraryRootController.js";

/** The library can change after activation, so the logger resolves the services on every call. */
export function openLibraryLogger(controller: Pick<LibraryRootController, "currentServices">): ILogger {
  const current = (): ILogger | undefined => controller.currentServices()?.logger;
  return {
    log: async (...args) => { await current()?.log(...args); },
    error: async (...args) => { await current()?.error(...args); },
  };
}
