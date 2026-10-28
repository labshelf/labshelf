// Runs project builds one at a time per project: a newer request cancels the running build and replaces the waiting one.
import type { ProjectEntry } from "../../project/index.js";
import type { ProjectBuildResult } from "../projectBuild.js";
import { buildProject, type ProjectBuildDeps, type ProjectBuildOptions } from "./buildProject.js";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;
type QueuedOptions = Omit<ProjectBuildOptions, "signal">;

interface QueuedBuild {
  project: ReadyProject;
  options: QueuedOptions;
  settle: (outcome: Promise<ProjectBuildResult>) => void;
}

interface ProjectBuilds {
  /** Settles when the last queued build does; never rejects, so one throwing build does not stop the next. */
  chain: Promise<unknown>;
  // INVARIANT: set while a build waits in the chain; a later request replaces it, so the latest one runs.
  queued?: QueuedBuild | undefined;
  running?: AbortController | undefined;
  // Roots whose last build typeset one chapter; latexmk skips the full rebuild unless it is forced.
  partial: Set<string>;
}

/** Typst live compiles of unsaved text bypass the queue: callers run `buildProject` for them directly. */
export class ProjectBuildQueue {
  private readonly builds = new Map<string, ProjectBuilds>();

  constructor(private readonly deps: ProjectBuildDeps) {}

  request(project: ReadyProject, options: QueuedOptions = {}): Promise<ProjectBuildResult> {
    const state: ProjectBuilds = this.builds.get(project.folder) ?? { chain: Promise.resolve(), partial: new Set() };
    this.builds.set(project.folder, state);
    state.running?.abort();
    const replaced = state.queued;
    const result = new Promise<ProjectBuildResult>((resolve) => { state.queued = { project, options, settle: resolve }; });
    // A replaced request resolves cancelled, so only the latest caller reports the build that runs.
    if (replaced) {
      replaced.settle(Promise.resolve({ status: "cancelled" }));
      return result;
    }
    state.chain = state.chain.then(() => {
      const next = state.queued!;
      state.queued = undefined;
      const run = this.run(state, next.project, next.options);
      next.settle(run);
      return run.catch(() => undefined);
    });
    return result;
  }

  cancelAll(): void {
    for (const state of this.builds.values()) { state.running?.abort(); }
  }

  private async run(state: ProjectBuilds, project: ReadyProject, options: QueuedOptions): Promise<ProjectBuildResult> {
    const root = options.root ?? project.main;
    const force = options.force === true || (options.includeOnly === undefined && root !== undefined && state.partial.has(root));
    const controller = new AbortController();
    state.running = controller;
    try {
      const result = await buildProject(project, this.deps, { ...options, signal: controller.signal, ...(force && { force: true }) });
      if (root !== undefined && (result.status === "succeeded" || result.status === "failed")) {
        if (options.includeOnly === undefined) { state.partial.delete(root); } else { state.partial.add(root); }
      }
      return result;
    } finally {
      if (state.running === controller) { state.running = undefined; }
    }
  }
}
