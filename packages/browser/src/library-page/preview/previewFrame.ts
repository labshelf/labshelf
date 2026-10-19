// Shows a project's build in the reader page embedded in preview mode, handing each assembled PDF over as a blob: URL and taking the reader's requests back.
import { checkPreviewRequest, type HostToWebview, type PreviewRequest, type PreviewRoots } from "@labshelf/core";

const READER_PAGE = "../reader/index.html";

export type PreviewBuildStatus = Omit<Extract<HostToWebview, { type: "buildStatus" }>, "type">;
type PreviewFrameMessage = Extract<HostToWebview, { type: "reloadDocument" | "buildStatus" | "previewRoots" }>;

export interface PreviewFrame {
  readonly element: HTMLIFrameElement;
  showPdf(bytes: Uint8Array): void;
  setBuildStatus(status: PreviewBuildStatus): void;
  setPreviewRoots(roots: PreviewRoots): void;
  /** Calls `listener` with each well-formed request the embedded reader sends; returns the unsubscribe. */
  onRequest(listener: (request: PreviewRequest) => void): () => void;
  /** Removes the iframe and frees the PDFs it handed over. */
  dispose(): void;
}

function previewReaderUrl(projectId: string, title: string): string {
  const query = new URLSearchParams({ preview: "1", project: projectId, title });
  return `${READER_PAGE}?${query.toString()}`;
}

export function createPreviewFrame(container: HTMLElement, project: { id: string; title: string }): PreviewFrame {
  const element = document.createElement("iframe");
  element.className = "ls-preview-frame";
  element.title = project.title;
  // Messages sent before the reader page loaded would reach about:blank; hold them until it loads.
  let loaded = false;
  const held: PreviewFrameMessage[] = [];
  // The newest URL is last; at most two stay alive.
  const urls: string[] = [];

  const post = (msg: PreviewFrameMessage): void => {
    if (!loaded) { held.push(msg); return; }
    element.contentWindow?.postMessage(msg, location.origin);
  };
  element.addEventListener("load", () => {
    loaded = true;
    for (const msg of held.splice(0)) post(msg);
  });
  const listeners = new Set<(request: PreviewRequest) => void>();
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin || event.source === null || event.source !== element.contentWindow) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || checkPreviewRequest(data as Record<string, unknown>) !== true) return;
    for (const listener of listeners) listener(data as PreviewRequest);
  };
  window.addEventListener("message", onMessage);
  container.append(element);
  // PLATFORM: Chrome takes an iframe document's prefers-color-scheme from its owner element, so a src set before append boots the reader light under a dark page.
  element.src = previewReaderUrl(project.id, project.title);

  return {
    element,
    showPdf(bytes) {
      // TRAP: the reader may still be fetching the previous URL when the next PDF arrives, so a URL is revoked only when a third one replaces it.
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      urls.push(url);
      if (urls.length > 2) URL.revokeObjectURL(urls.shift()!);
      post({ type: "reloadDocument", pdfUrl: url });
    },
    setBuildStatus(status) {
      post({ type: "buildStatus", ...status });
    },
    setPreviewRoots(roots) {
      post({ type: "previewRoots", roots });
    },
    onRequest(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      held.length = 0;
      listeners.clear();
      window.removeEventListener("message", onMessage);
      element.remove();
    },
  };
}
