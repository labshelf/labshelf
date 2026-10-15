/** Builds the extension's logger: the rotating app.log file. */
import { Logger, type ILogger } from "@labshelf/core";
import { FileLogSink } from "@labshelf/core/node";

/** The extension host console is the fallback channel when the sink fails. */
export function createExtensionLogger(appLogPath: string): ILogger {
  return new Logger([new FileLogSink(appLogPath)], {
    onSinkError: (error, entry) => {
      console.error("LabShelf: failed to write a log entry", { module: entry.module, message: entry.message, error });
    },
  });
}
