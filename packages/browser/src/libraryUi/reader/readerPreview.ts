// Reader page pieces that tests import without running the page: the browser-chord guards, the library-changed notice and the build-preview mode.
import type { BuildState, ILogger, PaperRecord, PreviewPorts, PreviewRequest, PreviewBuildRoots, ReaderHostController, SidecarChange } from "@labshelf/core";
import { bx, type LibraryChangedEvent } from "../../platform";

/** @returns whether the page runs on an Apple platform, where the command key is the shortcut modifier. */
export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

/** Chords VS Code's webview frame swallows (print, save) and drops that would navigate the tab away from the paper. */
export function installPageGuards(): void {
  const mac = isMacPlatform();
  document.addEventListener("keydown", (e) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && (key === "p" || key === "s")) { e.preventDefault(); return; }
    // Firefox opens Quick Find on these when nothing handles them; the reader has its own find bar.
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (!typing && !mod && !e.altKey && (e.key === "/" || e.key === "'") && !e.defaultPrevented) e.preventDefault();
  });
  for (const type of ["dragover", "drop"] as const) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
}

export function sendSidecarChange(paperId: string, change: SidecarChange): void {
  // A theme change shows nowhere in the library.
  if (change.kind === "theme") return;
  const changed: LibraryChangedEvent = { type: "library.changed", reason: "annotations", paperId };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(changed).catch(() => undefined);
}

// Turns the reader page into a build preview embedded by the library page: PDFs, build states and roots come from the parent page, requests go back to it.
// Opened as reader/index.html?preview=1&project=<id>&title=<name>.
const BUILD_STATES: readonly BuildState[] = ["building", "succeeded", "failed"];

export function findPreviewPaper(search: string): PaperRecord | undefined {
  const query = new URLSearchParams(search);
  if (query.get("preview") !== "1") return undefined;
  const project = query.get("project") ?? "";
  return { id: `preview:${project}`, title: query.get("title") ?? project, path: "", citeKey: "", status: "reading" };
}

function isFromParentPage(event: MessageEvent): boolean {
  return event.origin === location.origin && event.source === window.parent && window.parent !== window;
}

function isPreviewRoots(v: unknown): v is PreviewBuildRoots {
  if (typeof v !== "object" || v === null) return false;
  const roots = v as Record<string, unknown>;
  return typeof roots["main"] === "string" && typeof roots["shown"] === "string" && Array.isArray(roots["roots"]);
}

/**
 * Listens to the parent page's `reloadDocument`, `buildStatus` and `previewRoots` messages.
 * @returns the readBytes hook that reads the latest PDF the page handed over, waiting for the first one.
 */
export function attachPreviewPage(host: Pick<ReaderHostController, "reloadDocument" | "setBuildStatus" | "setPreviewRoots">): () => Promise<ArrayBuffer> {
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
export function createPreviewPorts(logger: ILogger): PreviewPorts {
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
