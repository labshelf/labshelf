/** Records what a module logs so tests can assert on warnings and errors. */
import type { ILogger } from "../../src/ports/index";

export interface RecordingLogger extends ILogger {
  logs: Array<{ level: string; module: string; message: string }>;
  errors: Array<{ module: string; context: Record<string, unknown> | undefined }>;
}

export function fakeLogger(): RecordingLogger {
  const logs: RecordingLogger["logs"] = [];
  const errors: RecordingLogger["errors"] = [];
  return {
    logs,
    errors,
    log: async (level, module, message) => { logs.push({ level, module, message }); },
    error: async (module, _error, context) => { errors.push({ module, context }); },
  };
}
