// Turns the reader page into a build preview embedded by the library page: PDFs, build states and roots come from the parent page, requests go back to it.
// Opened as reader/index.html?preview=1&project=<id>&title=<name>.
import type { BuildState, ILogger, PaperRecord, PreviewPorts, PreviewRequest, PreviewRoots, ReaderHostController } from "@labshelf/core";

const BUILD_STATES: readonly BuildState[] = ["building", "succeeded", "failed"];

export function previewPaper(search: string): PaperRecord | undefined {
  const query = new URLSearchParams(search);
  if (query.get("preview") !== "1") return undefined;
  const project = query.get("project") ?? "";
  return { id: `preview:${project}`, title: query.get("title") ?? project, path: "", citeKey: "", status: "reading" };
}

function isFromParentPage(event: MessageEvent): boolean {
  return event.origin === location.origin && event.source === window.parent && window.parent !== window;
}

function isPreviewRoots(v: unknown): v is PreviewRoots {
  if (typeof v !== "object" || v === null) return false;
  const roots = v as Record<string, unknown>;
  return typeof roots["main"] === "string" && typeof roots["shown"] === "string" && Array.isArray(roots["roots"]);
}

/**
 * Listens to the parent page's `reloadDocument`, `buildStatus` and `previewRoots` messages.
 * @returns the readBytes hook that reads the latest PDF the page handed over, waiting for the first one.
 */
export function bindPreviewPage(host: Pick<ReaderHostController, "reloadDocument" | "setBuildStatus" | "setPreviewRoots">): () => Promise<ArrayBuffer> {
  let latestUrl: string | undefined;
  let gotFirst: (url: string) => void = () => undefined;
  const first = new Promise<string>((resolve) => { gotFirst = resolve; });
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isFromParentPage(event)) return;
    const msg = event.data as { type?: unknown; pdfUrl?: unknown; state?: unknown; errors?: unknown; stale?: unknown; builtAt?: unknown; roots?: unknown };
    if (msg.type === "reloadDocument" && typeof msg.pdfUrl === "string" && msg.pdfUrl.startsWith("blob:")) {
      const isFirst = latestUrl === undefined;
      latestUrl = msg.pdfUrl;
      // The URL changes on every build; reloading without one keeps the reader's page, offset and zoom.
      if (isFirst) gotFirst(latestUrl);
      else host.reloadDocument();
    } else if (msg.type === "buildStatus" && BUILD_STATES.includes(msg.state as BuildState)) {
      host.setBuildStatus(msg.state as BuildState, typeof msg.errors === "number" ? msg.errors : 0, {
        ...(typeof msg.stale === "boolean" ? { stale: msg.stale } : {}),
        ...(typeof msg.builtAt === "number" ? { builtAt: msg.builtAt } : {}),
      });
    } else if (msg.type === "previewRoots" && isPreviewRoots(msg.roots)) {
      host.setPreviewRoots(msg.roots);
    }
  });
  return async () => {
    await first;
    const url = latestUrl ?? "";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read the preview PDF (HTTP ${response.status}).`);
    return response.arrayBuffer();
  };
}

/** The reader's preview ports: each request goes to the parent page, which carries it out. */
export function previewPorts(logger: ILogger): PreviewPorts {
  const ask = async (request: PreviewRequest): Promise<void> => { window.parent.postMessage(request, location.origin); };
  let warnedLookup = false;
  return {
    showSource: (point) => ask({ command: "showSource", point }),
    async lookupCitation(query) {
      // The parent page answers no citation lookups; warn once, since the reader asks on every hover.
      if (!warnedLookup) void logger.log("WARN", "reader", "preview citation lookup is not available", { link: query.link });
      warnedLookup = true;
      return [];
    },
    openCitedPaper: (paperId, page) => ask({ command: "openCitedPaper", paperId, ...(page !== undefined ? { page } : {}) }),
    recompile: () => ask({ command: "recompile" }),
    revealCursor: () => ask({ command: "revealCursor" }),
    openProblem: (root, index) => ask({ command: "openProblem", root, index }),
    openRawLog: (root) => ask({ command: "openRawLog", root }),
    runCommand: (id) => ask({ command: "runCommand", id }),
    setCheckLimits: (limits) => ask({ command: "setCheckLimits", limits }),
    setAutoCompile: (mode) => ask({ command: "setAutoCompile", mode }),
    setEngine: (engine) => ask({ command: "setEngine", engine }),
    setHaltOnError: (on) => ask({ command: "setHaltOnError", on }),
  };
}
