/**
 * Handles the messages that move text out of the reader: clipboard copies, the Markdown export, external links and citations into a project.
 */
import { formatQuoteWithCitation } from "../citationFormat.js";
import { isSafeExternalUrl } from "../protocol/index.js";
import { exportAnnotations } from "./exportAnnotations.js";
import { READER_LOG_MODULE, type MessageHandlers } from "./hostContext.js";

export const shareHandlers: Pick<
  MessageHandlers,
  "copyText" | "copyWithCitation" | "exportAnnotations" | "openExternalLink" | "citeInProject"
> = {
  copyText: async (ctx, msg) => {
    await ctx.ports.writeClipboard(msg.text);
    ctx.ports.notify("Copied to clipboard", "ok");
  },

  copyWithCitation: async (ctx, msg) => {
    const { ports } = ctx;
    const text = formatQuoteWithCitation(msg.text, ports.paper, msg.pageNumber, ports.getPrefs().citationStyle);
    await ports.writeClipboard(text);
    ports.notify(`Copied with citation (@${ports.paper.citeKey}, p. ${msg.pageNumber})`, "ok");
  },

  citeInProject: async (ctx, msg) => {
    const { ports } = ctx;
    if (!ports.citeInProject) {
      ports.notify("Cite in project is not available here", "info");
      return;
    }
    await ports.citeInProject({
      paperId: msg.paperId,
      ...(msg.page === undefined ? {} : { page: msg.page }),
      ...(msg.quote === undefined ? {} : { quote: msg.quote }),
    });
  },

  exportAnnotations: (ctx, msg) => exportAnnotations(ctx.ports, msg.target),

  // A crafted PDF must not open file:, command: or vscode: URIs.
  openExternalLink: async (ctx, msg) => {
    if (isSafeExternalUrl(msg.url)) {
      await ctx.ports.openExternal(msg.url);
    } else {
      void ctx.ports.logger.log("WARN", READER_LOG_MODULE, "Blocked external link with disallowed scheme", { paperId: ctx.ports.paper.id });
    }
  },
};
