// Shows each PDF and build status of a project on a preview frame.
import type { ILogger } from "@labshelf/core";
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

/** Starts a build and keeps the frame in step with every build until disposed. */
export function followBuilds(source: PreviewBuildSource, frame: Pick<PreviewFrame, "showPdf" | "setBuildStatus">, projectId: string, logger: ILogger): { dispose(): void } {
  let disposed = false;
  const off = source.onBuild((event) => {
    if (disposed) return;
    if (event.type === "building") frame.setBuildStatus({ state: "building", errors: 0 });
    else if (event.type === "pdf") frame.showPdf(event.bytes);
    else frame.setBuildStatus(statusOf(event.result));
  });
  source.build(projectId).catch(async (error: unknown) => {
    await logger.error("preview", error, { action: "build", projectId });
    if (!disposed) frame.setBuildStatus({ state: "failed", errors: 1 });
  });

  return { dispose() { disposed = true; off(); } };
}
