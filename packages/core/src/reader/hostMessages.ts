// Handles the reader messages the host answers: annotations, export, preview requests, session and sharing.
import {
  type WebviewToHost, isSafeExternalUrl, formatAnnotationsMarkdown, formatQuoteWithCitation, type CitationEntry,
  type PreviewRequest,
} from "./protocol/index.js";
import { formatError } from "../errors/index.js";
import { normalizeReadingPosition, compareAnnotations } from "./sidecar/index.js";
import { READER_LOG_MODULE, type HostContext, type MessageAnswers, type ExportAnnotationsPorts } from "./hostPorts.js";
import { isPdfTheme } from "../model/index.js";
import { loadReaderNotes } from "./noteMessages.js";

// Handles the reader messages that write the paper's sidecar: annotation create, update and delete, and the reading position.

type StoreResult<T> = { ok: true; value: T } | { ok: false };

/** A rejected annotation write becomes a specific notice, and the reader keeps the list it has. */
async function writeAnnotation<T>(
  ctx: HostContext,
  verb: "create" | "update" | "delete",
  command: WebviewToHost["command"],
  write: () => Promise<T>,
): Promise<StoreResult<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (err) {
    void ctx.ports.logger.error(READER_LOG_MODULE, err, { paperId: ctx.ports.paper.id, command });
    ctx.ports.notify(`Failed to ${verb} annotation: ${formatError(err)}`, "error");
    return { ok: false };
  }
}

async function pushStoredAnnotations(ctx: HostContext): Promise<void> {
  ctx.pushAnnotations(await ctx.ports.store.getAnnotations(ctx.ports.paper.id), true);
}

export const annotationHandlers: Pick<
  MessageAnswers,
  "createAnnotation" | "updateAnnotation" | "deleteAnnotation" | "saveReadingState"
> = {
  createAnnotation: async (ctx, msg) => {
    const { store, paper } = ctx.ports;
    // The reader sends null for a highlight without a stored rectangle.
    const result = await writeAnnotation(ctx, "create", msg.command, () =>
      store.addHighlight(paper.id, msg.pageNumber, msg.content, msg.color ?? "yellow", msg.position ?? undefined, msg.style));
    if (!result.ok) { return; }
    await pushStoredAnnotations(ctx);
    ctx.ports.sidecarChanged?.({ kind: "annotationCreated", annotation: result.value });
  },

  updateAnnotation: async (ctx, msg) => {
    const { store, paper } = ctx.ports;
    const result = await writeAnnotation(ctx, "update", msg.command, () => store.updateAnnotation(paper.id, msg.id, msg.content));
    if (!result.ok) { return; }
    await pushStoredAnnotations(ctx);
    ctx.ports.sidecarChanged?.({ kind: "annotationUpdated", annotation: result.value });
  },

  deleteAnnotation: async (ctx, msg) => {
    const { store, paper } = ctx.ports;
    const result = await writeAnnotation(ctx, "delete", msg.command, () => store.deleteAnnotation(paper.id, msg.id));
    if (!result.ok) { return; }
    await pushStoredAnnotations(ctx);
    if (result.value) { ctx.ports.sidecarChanged?.({ kind: "annotationDeleted", annotationId: msg.id }); }
  },

  // Not a sidecar change for the host: the position rides along with the next sync.
  saveReadingState: async (ctx, msg) => {
    const state = normalizeReadingPosition(msg.state);
    if (state) { await ctx.ports.store.setReadingState(ctx.ports.paper.id, state); }
  },
};

// Exports a paper's annotations as Markdown, for the reader's export buttons and for host commands outside the reader.

/**
 * Copies the Markdown to the clipboard with a confirmation, or hands it to the host to save as a file.
 * @returns resolves once the copy or the host's save has finished.
 */
export async function exportAnnotations(ports: ExportAnnotationsPorts, target: "clipboard" | "file"): Promise<void> {
  const markdown = formatAnnotationsMarkdown(ports.paper, await ports.store.getAnnotations(ports.paper.id));
  if (target === "clipboard") {
    await ports.writeClipboard(markdown);
    ports.notify("Annotations copied as Markdown", "ok");
    return;
  }
  await ports.saveAnnotations(markdown);
}

// Handles the requests a preview reader makes of its host: the source behind a point, the papers a citation names and the writing actions.

// The reader shows the logs view, double-click to source and citation cards only in a preview, so a missing port is a host bug.
function previewPorts(ctx: HostContext, command: string) {
  const { preview, logger, paper } = ctx.ports;
  if (!preview) {
    void logger.log("WARN", READER_LOG_MODULE, "Preview request in a reader that previews nothing", { paperId: paper.id, command });
  }
  return preview;
}

export const previewHandlers: Pick<
  MessageAnswers,
  PreviewRequest["command"]
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
    await previewPorts(ctx, "openCitedPaper")?.openCitedPaper(msg.paperId, msg.page);
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

  // The ports below are optional: a host that lacks one ignores the request.
  runCommand: async (ctx, msg) => {
    await previewPorts(ctx, "runCommand")?.runCommand?.(msg.id);
  },

  setAutoCompile: async (ctx, msg) => {
    await previewPorts(ctx, "setAutoCompile")?.setAutoCompile?.(msg.mode);
  },

  setEngine: async (ctx, msg) => {
    await previewPorts(ctx, "setEngine")?.setEngine?.(msg.engine);
  },

  setIncludeOnly: async (ctx, msg) => {
    await previewPorts(ctx, "setIncludeOnly")?.setIncludeOnly?.(msg.on);
  },

  setHaltOnError: async (ctx, msg) => {
    await previewPorts(ctx, "setHaltOnError")?.setHaltOnError?.(msg.on);
  },

  setCheckLimits: async (ctx, msg) => {
    await previewPorts(ctx, "setCheckLimits")?.setCheckLimits?.(msg.limits);
  },

  fixCitation: async (ctx, msg) => {
    await previewPorts(ctx, "fixCitation")?.fixCitation?.(msg.fix);
  },

  openSourceLine: async (ctx, msg) => {
    await previewPorts(ctx, "openSourceLine")?.openSourceLine?.(msg.file, msg.line);
  },

  addReviewComment: async (ctx, msg) => {
    await previewPorts(ctx, "addReviewComment")?.addReviewComment?.(msg.point, msg.quote, msg.note);
  },
};

// Handles the reader session messages: the init handshake, readiness, open timing, and theme choice.

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
    // An unreadable notes file must not keep the reader from opening the PDF.
    const notes = await loadReaderNotes(ports.notes, ports.paper.id).catch((err: unknown) => {
      void ports.logger.error(READER_LOG_MODULE, err, { paperId: ports.paper.id, command: "ready-for-init" });
      return [];
    });
    state.lastNotesKey = JSON.stringify(notes);
    ports.post({
      type: "init",
      paper: ports.paper,
      reading: data.reading ?? null,
      annotations,
      notes,
      prefs: ports.getPrefs(),
      theme: data.theme,
      effectiveTheme: ctx.effectiveTheme(data.theme),
      ...(ports.runCell ? { canRunCells: true } : {}),
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

// Handles the messages that move text out of the reader: clipboard copies, the Markdown export, external links and citations into a project.

export const shareHandlers: Pick<
  MessageAnswers,
  "copyText" | "copyWithCitation" | "exportAnnotations" | "openExternalLink" | "citeInProject" | "sendToNote"
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

  sendToNote: async (ctx, msg) => {
    const { ports } = ctx;
    if (!ports.sendToNote) {
      ports.notify("Send to is not available here", "info");
      return;
    }
    try {
      await ports.sendToNote({ key: ports.paper.citeKey, page: msg.pageNumber, text: msg.text });
    } catch (error) {
      void ports.logger.error(READER_LOG_MODULE, error, { paperId: ports.paper.id });
      ports.notify(`Failed to send: ${formatError(error)}`, "error");
    }
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
