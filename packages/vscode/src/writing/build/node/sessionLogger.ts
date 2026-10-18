// Forwards log entries to the logger of the library open at that moment.
import type { ILogger } from "@labshelf/core";

import type { WritingHost } from "../../session/index.js";

/** Long-lived objects keep one logger while the open library, and so its log file, can change. */
export function sessionLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}
