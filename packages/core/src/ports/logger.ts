// Declares the structured logger port that apps implement and inject.
import type { LogEntry } from "../model/index.js";

export interface ILogger {
  log(
    level: LogEntry["level"],
    module: string,
    message: string,
    context?: Record<string, unknown>,
    stack?: string,
  ): Promise<void>;
  error(module: string, error: unknown, context?: Record<string, unknown>): Promise<void>;
}
