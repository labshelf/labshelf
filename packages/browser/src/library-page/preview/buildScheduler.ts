// Schedules the project preview through the browser helper connection.
import type { ILogger } from "@labshelf/core";
import type { CompileMode, HelperCompileRequest, HelperCompileResult, ILatexHelper } from "@labshelf/core/helper";

import { createBuildRunner } from "./buildRunner";

const PREVIEW_IDLE_MS = 500;
const FULL_IDLE_MS = 2000;

export interface BuildTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BuildSchedulerOptions {
  helper: Pick<ILatexHelper, "compile" | "cancel">;
  target: Omit<HelperCompileRequest, "mode" | "editedFile" | "editedLine">;
  /** An edit supersedes an in-flight result; a save waits for the active preview. */
  onResult(result: HelperCompileResult, mode: CompileMode): void;
  onStart(): void;
  logger: ILogger;
  timers?: BuildTimers;
}

export interface BuildScheduler {
  /** Call after every edit of `file`. */
  edit(file: string, line?: number): void;
  /** Call after the page wrote a source file. */
  save(): void;
  dispose(): void;
}

const browserTimers: BuildTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createBuildScheduler(options: BuildSchedulerOptions): BuildScheduler {
  const { timers = browserTimers } = options;
  const { build, supersede } = createBuildRunner(options);
  let previewTimer: unknown;
  let fullTimer: unknown;
  let disposed = false;

  const clearTimers = (): void => {
    timers.clearTimeout(previewTimer);
    timers.clearTimeout(fullTimer);
  };

  return {
    edit(file, line) {
      if (disposed) return;
      clearTimers();
      supersede();
      previewTimer = timers.setTimeout(() => build("preview", file, line), PREVIEW_IDLE_MS);
      fullTimer = timers.setTimeout(() => build("full"), FULL_IDLE_MS);
    },
    save() {
      if (disposed) return;
      clearTimers();
      build("full");
    },
    dispose() {
      disposed = true;
      clearTimers();
      supersede();
    },
  };
}
