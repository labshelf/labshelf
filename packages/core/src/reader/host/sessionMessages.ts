/**
 * Handles the reader session messages: the init handshake, readiness, open timing, and theme choice.
 */
import { isPdfTheme } from "../../model/index.js";
import { compareAnnotations } from "../sidecar/index.js";
import { READER_LOG_MODULE, type MessageAnswers } from "./hostContext.js";

export const sessionHandlers: Pick<
  MessageAnswers,
  "ready-for-init" | "ready" | "perf" | "selectTheme"
> = {
  "ready-for-init": async (ctx) => {
    const { ports, state } = ctx;
    const data = await ports.store.load(ports.paper.id);
    state.themePreference = data.theme;
    const annotations = [...data.annotations].sort(compareAnnotations);
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
    for (const held of state.held.values()) { ports.post(held); }
    state.held.clear();
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

  selectTheme: async (ctx, msg) => {
    if (!isPdfTheme(msg.theme)) { return; }
    const { ports, state } = ctx;
    state.themePreference = msg.theme;
    await ports.store.setTheme(ports.paper.id, msg.theme);
    ports.post({ type: "applyTheme", theme: msg.theme, effectiveTheme: ctx.effectiveTheme(msg.theme) });
    ports.sidecarChanged?.({ kind: "theme" });
  },
};
