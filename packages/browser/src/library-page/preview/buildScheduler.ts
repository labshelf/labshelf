// Schedules a project's helper builds: a preview 500 ms after the last edit, a full build on save and after 2 s idle.
// CONTRACT: documents/contracts/helper.md#version
import type { ILogger } from "@labshelf/core";
import type { CompileMode, HelperCompileRequest, HelperCompileResult, ILatexHelper } from "@labshelf/core/helper";

const PREVIEW_IDLE_MS = 500;
const FULL_IDLE_MS = 2000;
const LOG_MODULE = "preview";

export interface BuildTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BuildSchedulerOptions {
  helper: Pick<ILatexHelper, "compile" | "cancel">;
  target: Omit<HelperCompileRequest, "mode" | "editedFile" | "editedLine">;
  /** Gets only the result of the latest build; a build superseded by an edit or save never reports. */
  onResult(result: HelperCompileResult, mode: CompileMode): void;
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

type BuildRunnerOptions = Omit<BuildSchedulerOptions, "timers">;

// Runs one build at a time; starting a build or superseding drops the result of the build in flight.
function createBuildRunner({ helper, target, onResult, logger }: BuildRunnerOptions) {
  let generation = 0;
  let running = false;

  // Bumping the generation makes the build in flight report nothing; cancel only frees the helper sooner.
  const supersede = (): void => {
    generation++;
    if (!running) return;
    running = false;
    helper.cancel(target.projectId).catch((err: unknown) => {
      void logger.error(LOG_MODULE, err, { op: "cancel", projectId: target.projectId });
    });
  };

  const build = (mode: CompileMode, editedFile?: string, editedLine?: number): void => {
    supersede();
    const mine = generation;
    running = true;
    const request: HelperCompileRequest = { ...target, mode, ...(editedFile === undefined ? {} : { editedFile }), ...(editedLine === undefined ? {} : { editedLine }) };
    helper.compile(request, () => undefined).then(
      (result) => { if (mine === generation) { running = false; onResult(result, mode); } },
      (err: unknown) => {
        if (mine !== generation) return;
        running = false;
        void logger.error(LOG_MODULE, err, { op: "compile", projectId: target.projectId, mode });
      },
    );
  };
  return { build, supersede };
}

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
