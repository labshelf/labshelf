// Logs the demo's failures to the browser console; there is no log file on a web page.
import type { ILogger } from "@labshelf/core";

export const consoleLogger: ILogger = {
  log: async (level, module, message, context) => {
    if (level === "WARN" || level === "ERROR") console.warn(`[${module}] ${message}`, context ?? "");
  },
  error: async (module, error, context) => { console.error(`[${module}]`, error, context ?? ""); },
};
