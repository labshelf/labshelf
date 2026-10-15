/**
 * Handles the requests a preview reader makes of its host: the failed build's first error and the source behind a point.
 */
import { READER_LOG_MODULE, type HostContext, type MessageHandlers } from "./hostContext.js";

// The reader shows the build banner and enables double-click to source only in a preview, so a missing port is a host bug.
function previewPorts(ctx: HostContext, command: string) {
  const { preview, logger, paper } = ctx.ports;
  if (!preview) {
    void logger.log("WARN", READER_LOG_MODULE, "Preview request in a reader that previews nothing", { paperId: paper.id, command });
  }
  return preview;
}

export const previewHandlers: Pick<MessageHandlers, "showBuildProblem" | "showSource"> = {
  showBuildProblem: async (ctx) => {
    await previewPorts(ctx, "showBuildProblem")?.showBuildProblem();
  },

  showSource: async (ctx, msg) => {
    await previewPorts(ctx, "showSource")?.showSource(msg.point);
  },
};
