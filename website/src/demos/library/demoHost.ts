// Answers the library UI from the in-memory demo library; edits stay in memory and every app-only action says so.
import {
  formatError, listPaperFiles, derivePaperDetails, PDF_FILE,
  type HostEndpoint, type HostToUi, type ILogger, type UiToHost,
} from "@labshelf/core";

import type { DemoLibrary } from "./demoLibrary.js";
import { createMemoryFileSystem } from "./memoryFileSystem.js";

export const APP_ONLY_NOTICE = "Available in the app";
const MODULE = "website-demo";

function pdfOf(library: DemoLibrary, id: string): { size: number; relPath: string } | null {
  const paper = library.paper(id);
  const file = paper && library.files.find((f) => f.path === `${paper.path}/${PDF_FILE}`);
  return file ? { size: file.size, relPath: file.path.slice("papers/".length) } : null;
}

async function answer(library: DemoLibrary, m: UiToHost, post: (m: HostToUi) => void, log: ILogger): Promise<void> {
  const fs = createMemoryFileSystem(library.files);
  switch (m.type) {
    case "ready":
      post({ type: "navigate", folder: "papers" });
      post({ type: "snapshot", snapshot: library.snapshot() });
      return;
    case "navigate": case "paper.selected": return;
    case "paper.details": post({ type: "details", id: m.id, details: derivePaperDetails(library.sidecar(m.id), pdfOf(library, m.id)) }); return;
    case "paper.files": {
      const paper = library.paper(m.id);
      if (!paper) throw new Error(`Unknown paper ${m.id}`);
      post({ type: "files", id: m.id, state: await listPaperFiles(fs, paper.path, paper.files, log) });
      return;
    }
    case "paper.setStatus": library.setStatus(m.ids, m.status); break;
    case "paper.setTags": library.setTags(m.ids, m.add, m.remove); break;
    case "paper.setNote": library.setNote(m.id, m.note); break;
    case "clipboard.write":
      await navigator.clipboard.writeText(m.text);
      post({ type: "notice", kind: "ok", text: m.label ? `Copied ${m.label}` : "Copied" });
      return;
    default:
      post({ type: "notice", kind: "info", text: APP_ONLY_NOTICE });
      return;
  }
  post({ type: "snapshot", snapshot: library.snapshot() });
}

/** Starts answering the UI on `endpoint`. */
export function attachDemoHost(endpoint: HostEndpoint, library: DemoLibrary, log: ILogger): () => void {
  return endpoint.subscribe((m) => {
    answer(library, m, (reply) => endpoint.post(reply), log).catch((err: unknown) => {
      endpoint.post({ type: "notice", kind: "error", text: formatError(err) });
      void log.error(MODULE, err, { type: m.type });
    });
  });
}
