/**
 * Declares the other ports apps implement and inject: the structured logger, the sink log entries go to, the slice of
 * `fetch` network code needs, and where a platform keeps one sidecar per paper.
 */
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

export interface LogSink {
  append(entry: LogEntry): Promise<void>;
}

/** The slice of `fetch` that network code needs, so apps and tests can inject their own. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

export interface SidecarPort {
  /** The sidecar text, or null when the paper has none yet. */
  read(paperId: string): Promise<string | null>;
  write(paperId: string, text: string): Promise<void>;
}
