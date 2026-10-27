// Schedules the project preview through the browser helper connection.
import type { BuildSchedule, ILogger } from "@labshelf/core";
import type { BuildKind, HelperCompileRequest, HelperCompileResult, ILatexHelper } from "@labshelf/core/helper";

import { createBuildRunner } from "./buildRunner";

const PREVIEW_IDLE_MS = 500;
const FULL_IDLE_MS = 2000;

export interface BuildTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type BuildSpec = Omit<HelperCompileRequest, "mode" | "editedFile" | "editedLine">;

export interface BuildSchedulerOptions {
  helper: Pick<ILatexHelper, "compile" | "cancel">;
  target: BuildSpec;
  /** When edits and saves start builds; `build` always does. */
  mode: BuildSchedule;
  /** An edit supersedes an in-flight result; a save waits for the active preview. */
  onResult(result: HelperCompileResult, mode: BuildKind): void;
  onStart(): void;
  logger: ILogger;
  timers?: BuildTimers;
}

export interface BuildScheduler {
  /** Call after every edit of `file`. */
  edit(file: string, line?: number): void;
  /** Call after the page wrote a source file; `explicit` when the user asked to save. */
  save(explicit: boolean): void;
  /** Builds in full whatever the mode. */
  build(): void;
  setMode(mode: BuildSchedule): void;
  /** The next build compiles with the changed target. */
  setTarget(patch: Partial<Pick<BuildSpec, "engine" | "haltOnError">>): void;
  dispose(): void;
}

const browserTimers: BuildTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createBuildScheduler(options: BuildSchedulerOptions): BuildScheduler {
  const { timers = browserTimers } = options;
  // INVARIANT: the runner reads this object on every build, so `setTarget` reaches the next compile.
  const target: BuildSpec = { ...options.target };
  const { build, supersede } = createBuildRunner({ ...options, target });
  let mode = options.mode;
  let previewTimer: unknown;
  let fullTimer: unknown;
  let disposed = false;

  const clearTimers = (): void => {
    timers.clearTimeout(previewTimer);
    timers.clearTimeout(fullTimer);
  };

  const buildFull = (): void => {
    if (disposed) return;
    clearTimers();
    build("full");
  };

  return {
    edit(file, line) {
      if (disposed || mode !== "typing") return;
      clearTimers();
      supersede();
      previewTimer = timers.setTimeout(() => build("preview", file, line), PREVIEW_IDLE_MS);
      fullTimer = timers.setTimeout(() => build("full"), FULL_IDLE_MS);
    },
    save(explicit) {
      if (mode === "off" || (mode === "save" && !explicit)) return;
      buildFull();
    },
    build: buildFull,
    setMode(next) {
      mode = next;
      clearTimers();
    },
    setTarget(patch) {
      Object.assign(target, patch);
    },
    dispose() {
      disposed = true;
      clearTimers();
      supersede();
    },
  };
}
