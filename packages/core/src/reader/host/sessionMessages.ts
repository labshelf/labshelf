/**
 * Handlers for the reader session: the init handshake, readiness, open timing, page and zoom reports, and theme choice.
 */
import { isPdfTheme } from "../../model/index.js";
import { byPageThenCreated } from "../paperData.js";
import { READER_LOG_MODULE, type MessageHandlers } from "./hostContext.js";

export const sessionHandlers: Pick<
  MessageHandlers,
  "ready-for-init" | "ready" | "perf" | "pageChanged" | "zoomChanged" | "selectTheme"
> = {
  "ready-for-init": async (ctx) => {
    const { ports, state } = ctx;
    const data = await ports.store.load(ports.paper.id);
    state.themePreference = data.theme;
    const annotations = [...data.annotations].sort(byPageThenCreated);
    state.lastAnnotationsKey = JSON.stringify(annotations);
    ports.post({
      type: "init",
      reading: data.reading ?? null,
      annotations,
      prefs: ports.getPrefs(),
      theme: data.theme,
      effectiveTheme: ctx.effectiveTheme(data.theme),
    });
  },

  ready: (ctx, msg) => {
    const { ports, state } = ctx;
    state.ready = true;
    void ports.logger.log("INFO", READER_LOG_MODULE, "Reader ready", { paperId: ports.paper.id, totalPages: msg.totalPages });
    ports.activity?.opened();
    if (state.pendingPage !== undefined) {
      ports.post({ type: "scrollToPage", pageNumber: state.pendingPage });
      state.pendingPage = undefined;
    }
  },

  perf: (ctx, msg) => {
    // hostMs spans the whole open as the user feels it; timeline entries are ms since the reader page began loading.
    void ctx.ports.logger.log("INFO", READER_LOG_MODULE, "PDF open timeline", {
      paperId: ctx.ports.paper.id,
      hostMs: ctx.now() - ctx.state.openedAt,
      timeline: msg.timeline,
      theme: msg.theme,
      dpr: msg.dpr,
      canvas: msg.canvas,
    });
  },

  pageChanged: (ctx, msg) => {
    ctx.ports.activity?.pageChanged(msg.pageNumber);
  },

  // The reading position arrives through saveReadingState; the protocol keeps this message accepted.
  zoomChanged: () => undefined,

  selectTheme: async (ctx, msg) => {
    if (!isPdfTheme(msg.theme)) { return; }
    const { ports, state } = ctx;
    state.themePreference = msg.theme;
    await ports.store.setTheme(ports.paper.id, msg.theme);
    ports.post({ type: "applyTheme", theme: msg.theme, effectiveTheme: ctx.effectiveTheme(msg.theme) });
    ports.sidecarChanged?.({ kind: "theme" });
  },
};
