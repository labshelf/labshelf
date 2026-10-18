// Creates the helper's file logger; stdout is reserved for frames.
import * as path from "node:path";

import { Logger } from "../../../../logging/index.js";
import { type ILogger } from "../../../../ports/index.js";
import { FileLogSink } from "../../../../logging/node/index.js";

export function createHelperLogger(dataDir: string): ILogger {
  return new Logger([new FileLogSink(path.join(dataDir, "logs", "helper.log"))], { onSinkError: () => undefined });
}
