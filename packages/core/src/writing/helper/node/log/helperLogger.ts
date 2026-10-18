// Creates the helper's file logger; stdout is reserved for frames. Every line passes the redaction step.
import * as path from "node:path";

import { Logger } from "../../../../logging/index.js";
import { type ILogger, type LogSink } from "../../../../ports/index.js";
import { FileLogSink } from "../../../../logging/node/index.js";
import { redactValue } from "./redact.js";

/** A logger that can be told secrets (the socket token) to hide from every later line. */
export interface HelperLogger extends ILogger {
  redact(secret: string): void;
}

export function createHelperLogger(dataDir: string): HelperLogger {
  const logsDir = path.join(dataDir, "logs");
  const file = new FileLogSink(path.join(logsDir, "helper.log"), { privateDirs: [dataDir, logsDir] });
  const secrets = new Set<string>();
  const sink: LogSink = { append: (entry) => file.append(redactValue(entry, secrets)) };
  const logger = new Logger([sink], { onSinkError: () => undefined });
  return {
    log: (...args) => logger.log(...args),
    error: (...args) => logger.error(...args),
    redact: (secret) => { if (secret.length > 0) secrets.add(secret); },
  };
}
