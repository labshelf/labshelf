/**
 * Handles the requests a preview reader makes of its host: the source behind a point, the papers a citation names and the writing actions.
 */
import type { CitationEntry } from "../previewProtocol.js";
import { READER_LOG_MODULE, type HostContext, type MessageHandlers } from "./hostContext.js";

// The reader shows the logs view, double-click to source and citation cards only in a preview, so a missing port is a host bug.
function previewPorts(ctx: HostContext, command: string) {
  const { preview, logger, paper } = ctx.ports;
  if (!preview) {
    void logger.log("WARN", READER_LOG_MODULE, "Preview request in a reader that previews nothing", { paperId: paper.id, command });
  }
  return preview;
}

export const previewHandlers: Pick<
  MessageHandlers,
  "showSource" | "lookupCitation" | "openCitedPaper" | "recompile" | "revealCursor" | "openProblem" | "openRawLog" | "bodyPages"
> = {
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

  recompile: async (ctx) => {
    await previewPorts(ctx, "recompile")?.recompile();
  },

  revealCursor: async (ctx) => {
    await previewPorts(ctx, "revealCursor")?.revealCursor();
  },

  openProblem: async (ctx, msg) => {
    await previewPorts(ctx, "openProblem")?.openProblem(msg.root, msg.index);
  },

  openRawLog: async (ctx, msg) => {
    await previewPorts(ctx, "openRawLog")?.openRawLog(msg.root);
  },

  bodyPages: async (ctx, msg) => {
    await previewPorts(ctx, "bodyPages")?.bodyPages?.(msg.root, msg.contentPages);
  },
};
