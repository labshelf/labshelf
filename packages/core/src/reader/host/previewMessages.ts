/**
 * Handles the requests a preview reader makes of its host: the failed build's first error, the source behind a point and the papers a citation names.
 */
import type { CitationEntry } from "../previewProtocol.js";
import { READER_LOG_MODULE, type HostContext, type MessageHandlers } from "./hostContext.js";

// The reader shows the build banner, double-click to source and citation cards only in a preview, so a missing port is a host bug.
function previewPorts(ctx: HostContext, command: string) {
  const { preview, logger, paper } = ctx.ports;
  if (!preview) {
    void logger.log("WARN", READER_LOG_MODULE, "Preview request in a reader that previews nothing", { paperId: paper.id, command });
  }
  return preview;
}

export const previewHandlers: Pick<MessageHandlers, "showBuildProblem" | "showSource" | "lookupCitation" | "openCitedPaper"> = {
  showBuildProblem: async (ctx) => {
    await previewPorts(ctx, "showBuildProblem")?.showBuildProblem();
  },

  showSource: async (ctx, msg) => {
    await previewPorts(ctx, "showSource")?.showSource(msg.point);
  },

  // Always answered, so a reader waiting on the request falls back to its own link preview instead of hanging.
  lookupCitation: async (ctx, msg) => {
    let entries: CitationEntry[] = [];
    try {
      entries = (await previewPorts(ctx, "lookupCitation")?.lookupCitation(msg.query)) ?? [];
    } finally {
      ctx.ports.post({ type: "citation", request: msg.request, entries });
    }
  },

  openCitedPaper: async (ctx, msg) => {
    await previewPorts(ctx, "openCitedPaper")?.openCitedPaper(msg.paperId);
  },
};
