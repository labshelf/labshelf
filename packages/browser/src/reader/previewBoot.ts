// Turns the reader page into a build preview embedded by the library page: the PDFs and build states come from the parent page.
// Opened as reader/index.html?preview=1&project=<id>&title=<name>.
import type { BuildState, PaperRecord, ReaderHostController } from "@labshelf/core";

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

/**
 * Listens to the parent page's `reloadDocument` and `buildStatus` messages.
 * @returns the readBytes hook that reads the latest PDF the page handed over, waiting for the first one.
 */
export function bindPreviewPage(host: Pick<ReaderHostController, "reloadDocument" | "setBuildStatus">): () => Promise<ArrayBuffer> {
  let latestUrl: string | undefined;
  let gotFirst: (url: string) => void = () => undefined;
  const first = new Promise<string>((resolve) => { gotFirst = resolve; });
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isFromParentPage(event)) return;
    const msg = event.data as { type?: unknown; pdfUrl?: unknown; state?: unknown; errors?: unknown; stale?: unknown; builtAt?: unknown };
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
