// Shows each PDF, build status and build root of a project on a preview frame.
import { previewProblems, type BuildOptions, type ILogger, type PreviewRoots } from "@labshelf/core";
import type { CompileMode, HelperCompileResult } from "@labshelf/core/helper";
import type { PreviewBuildStatus, PreviewFrame } from "./previewFrame";

export type PreviewBuildEvent = { type: "building" } | { type: "pdf"; bytes: Uint8Array; mode: CompileMode } | { type: "result"; result: HelperCompileResult };

export interface PreviewBuildSource {
  build(projectId: string): Promise<unknown>;
  onBuild(listener: (event: PreviewBuildEvent) => void): () => void;
}

function statusOf(result: HelperCompileResult): PreviewBuildStatus {
  switch (result.status) {
    case "succeeded": return { state: "succeeded", errors: 0, builtAt: Date.now() };
    case "cancelled": return { state: "failed", errors: 0, stale: true };
    default: return { state: "failed", errors: Math.max(1, result.problems.length) };
  }
}

/** The check limits of the project's labshelf.yaml. */
export interface PreviewLimits { pages?: number | undefined; words?: number | undefined; countUpTo?: PreviewRoots["countUpTo"] }

function rootsOf(main: string, result: HelperCompileResult, { pages, words, countUpTo }: PreviewLimits, options: BuildOptions | undefined): PreviewRoots {
  // The helper builds only the main file and keeps no raw log or source map the page can open.
  const root = { path: main, failed: result.status !== "succeeded", rawLog: false, sourceLinks: false, problems: previewProblems(result.problems) };
  return {
    main, focused: main, shown: main, roots: [root],
    ...(pages !== undefined ? { pageLimit: pages } : {}), ...(words !== undefined ? { wordLimit: words } : {}), ...(countUpTo !== undefined ? { countUpTo } : {}),
    ...(options !== undefined ? { options: { ...options } } : {}),
  };
}

export interface FollowedBuilds {
  /** The roots last posted to the frame. */
  roots(): PreviewRoots | undefined;
  /** Posts the last roots again with the project's current limits and build options. */
  resendRoots(): void;
  dispose(): void;
}

/** Starts a build and keeps the frame in step with every build until disposed. */
export function followBuilds(
  source: PreviewBuildSource, frame: Pick<PreviewFrame, "showPdf" | "setBuildStatus" | "setPreviewRoots">,
  project: { id: string; main: string | undefined; limits?: () => PreviewLimits; options?: () => BuildOptions }, logger: ILogger,
): FollowedBuilds {
  let disposed = false;
  let last: HelperCompileResult | undefined;
  let posted: PreviewRoots | undefined;
  const post = (): void => {
    if (last === undefined || project.main === undefined) return;
    posted = rootsOf(project.main, last, project.limits?.() ?? {}, project.options?.());
    frame.setPreviewRoots(posted);
  };
  const off = source.onBuild((event) => {
    if (disposed) return;
    if (event.type === "building") frame.setBuildStatus({ state: "building", errors: 0 });
    else if (event.type === "pdf") frame.showPdf(event.bytes);
    else {
      frame.setBuildStatus(statusOf(event.result));
      // A cancelled build has no problems of its own, so the roots of the last finished build stay; a project without a main file has no root to show.
      if (event.result.status !== "cancelled") { last = event.result; post(); }
    }
  });
  source.build(project.id).catch(async (error: unknown) => {
    await logger.error("preview", error, { action: "build", projectId: project.id });
    if (!disposed) frame.setBuildStatus({ state: "failed", errors: 1 });
  });

  return { roots: () => posted, resendRoots: post, dispose() { disposed = true; off(); } };
}
