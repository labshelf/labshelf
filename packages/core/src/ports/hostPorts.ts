/**
 * Declares the other ports apps implement and inject: the structured logger, the sink log entries go to, the slice of
 * `fetch` network code needs, where a platform keeps one sidecar per paper, and the native-messaging port native-host
 * clients talk through.
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

/** The native-messaging port a native-host client talks through; each app adapts its platform's port to it. */
export interface NativeMessagePort {
  post(frame: unknown): void;
  onMessage(listener: (frame: unknown) => void): void;
  /** `reason` is the platform's explanation for the close, when it gives one. */
  onDisconnect(listener: (reason: string | undefined) => void): void;
  disconnect(): void;
}
