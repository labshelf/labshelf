// Creates the helper's file logger; stdout is reserved for frames.
import * as path from "node:path";

import { Logger, type ILogger } from "@labshelf/core";
import { FileLogSink } from "@labshelf/core/node";

export function createHelperLogger(dataDir: string): ILogger {
  return new Logger([new FileLogSink(path.join(dataDir, "logs", "helper.log"))], { onSinkError: () => undefined });
}
