// Runs helper build requests without cancelling a preview for the same source revision.
import { formatError } from "@labshelf/core";
import type { CompileMode, HelperCompileRequest, HelperCompileResult } from "@labshelf/core/helper";
import type { BuildSchedulerOptions } from "./buildScheduler";

const LOG_MODULE = "preview";

type BuildRunnerOptions = Omit<BuildSchedulerOptions, "timers">;

// A save follows the active preview so autosave cannot repeatedly interrupt format creation.
export function createBuildRunner({ helper, target, onResult, onStart, logger }: BuildRunnerOptions) {
  let generation = 0;
  let running: CompileMode | undefined;
  let pendingFull = false;

  // Bumping the generation makes the build in flight report nothing; cancel only frees the helper sooner.
  const supersede = (): void => {
    generation++;
    pendingFull = false;
    if (!running) return;
    running = undefined;
    helper.cancel(target.projectId).catch((err: unknown) => {
      void logger.error(LOG_MODULE, err, { op: "cancel", projectId: target.projectId });
    });
  };

  const build = (mode: CompileMode, editedFile?: string, editedLine?: number): void => {
    if (mode === "full" && running === "full") return;
    if (mode === "full" && running === "preview") { pendingFull = true; return; }
    supersede();
    const mine = generation;
    running = mode;
    const request: HelperCompileRequest = { ...target, mode, ...(editedFile === undefined ? {} : { editedFile }), ...(editedLine === undefined ? {} : { editedLine }) };
    void logger.log("INFO", LOG_MODULE, "Build requested", { projectId: target.projectId, main: target.main, mode });
    onStart();
    const started = Date.now();
    const complete = (result: HelperCompileResult): void => {
      if (mine !== generation) return;
      running = undefined;
      const full = pendingFull;
      pendingFull = false;
      void logger.log("INFO", LOG_MODULE, "Build reply received", { projectId: target.projectId, mode, status: result.status, ms: Date.now() - started });
      onResult(result, mode);
      if (full) build("full");
    };
    helper.compile(request, () => undefined).then(
      complete,
      (err: unknown) => {
        void logger.error(LOG_MODULE, err, { op: "compile", projectId: target.projectId, mode, superseded: mine !== generation });
        if (mine !== generation) return;
        complete({ status: "failed", changed: [], problems: [{ severity: "error", file: target.main, message: formatError(err) }] });
      },
    );
  };
  return { build, supersede };
}

