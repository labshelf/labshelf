// Turns each helper build of a project into a PDF and a build status on a preview frame.
import type { ILogger } from "@labshelf/core";
import type { HelperCompileResult } from "@labshelf/core/helper";
import { assemblePdf } from "./pdfAssembly";
import type { PreviewBuildStatus, PreviewFrame } from "./previewFrame";

export type PreviewBuildEvent = { type: "building" } | { type: "result"; result: HelperCompileResult };

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
  let pdf: Uint8Array | undefined;
  // INVARIANT: results are assembled one at a time, in arrival order, because each builds on the previous PDF.
  let queue: Promise<void> = Promise.resolve();

  const apply = async (result: HelperCompileResult): Promise<void> => {
    try {
      if (result.status === "succeeded") {
        pdf = await assemblePdf(pdf, { pageCount: result.pageCount ?? 0, changed: result.changed });
        if (disposed) return;
        frame.showPdf(pdf);
      }
      if (!disposed) frame.setBuildStatus(statusOf(result));
    } catch (error) {
      await logger.error("preview", error, { action: "assemble", projectId });
      if (!disposed) frame.setBuildStatus({ state: "failed", errors: 1 });
    }
  };

  const off = source.onBuild((event) => {
    if (event.type === "building") { frame.setBuildStatus({ state: "building", errors: 0 }); return; }
    queue = queue.then(() => apply(event.result));
  });
  source.build(projectId).catch(async (error: unknown) => {
    await logger.error("preview", error, { action: "build", projectId });
    if (!disposed) frame.setBuildStatus({ state: "failed", errors: 1 });
  });

  return { dispose() { disposed = true; off(); } };
}
