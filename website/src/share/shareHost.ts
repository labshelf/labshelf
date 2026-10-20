// Answers the library UI from an opened share: reads are served from the manifest, and every edit is refused.
import {
  errorMessage, formatAnnotationsMarkdown, paperDetailsOf, PDF_FILE,
  type HostEndpoint, type HostToUi, type ILogger, type UiToHost,
} from "@labshelf/core";

import type { ShareLibrary } from "./shareLibrary.js";

const READ_ONLY_NOTICE = "This shared folder is read-only. Open it in LabShelf to keep your own copy.";
const MODULE = "share-page";

export interface ShareHostPorts {
  library: ShareLibrary;
  /** Opens the paper's PDF in the reader. */
  openPaper(id: string): void;
  /** The single selected paper, for the page's Download menu. */
  selected(id: string | null): void;
  /** Saves text as a file the visitor downloads. */
  saveText(name: string, text: string): void;
  log: ILogger;
}

function answer(ports: ShareHostPorts, m: UiToHost, post: (m: HostToUi) => void, openedAt: string): void {
  const { library } = ports;
  const known = (id: string) => {
    const paper = library.paper(id);
    if (!paper) throw new Error(`The share has no paper ${id}`);
    return paper;
  };
  const folderOf = (id: string) => `${library.folderPath.slice("papers/".length)}/${id}`;
  switch (m.type) {
    case "ready":
      post({ type: "navigate", folder: library.folderPath });
      post({ type: "snapshot", snapshot: library.snapshot });
      return;
    case "navigate": return;
    case "paper.selected": ports.selected(m.ids.length === 1 ? m.ids[0]! : null); return;
    case "paper.details": {
      const { pdf, annotations = [] } = known(m.id);
      const file = pdf ? { size: pdf.size, relPath: `${folderOf(m.id)}/${PDF_FILE}` } : null;
      post({ type: "details", id: m.id, details: paperDetailsOf({ annotations }, file) });
      return;
    }
    case "paper.files": {
      const { pdf } = known(m.id);
      const files = pdf ? [{ name: PDF_FILE, kind: "file" as const, size: pdf.size, modified: openedAt }] : [];
      post({ type: "files", id: m.id, state: { status: "ready", files } });
      return;
    }
    case "paper.open": case "paper.openFile":
      if (known(m.id).pdf) { ports.openPaper(m.id); return; }
      post({ type: "notice", kind: "info", text: "This paper was shared without a PDF." });
      return;
    case "paper.copyFilePath": void copy(post, `${folderOf(m.id)}/${m.name}`, "path"); return;
    case "clipboard.write": void copy(post, m.text, m.label); return;
    case "annotations.export": {
      const paper = known(m.id);
      const record = library.snapshot.papers.find((p) => p.id === m.id)!;
      ports.saveText(`${paper.metadata.citeKey || m.id}-annotations.md`, formatAnnotationsMarkdown(record, paper.annotations ?? []));
      return;
    }
    default:
      // The UI applies status, tag and note edits before it sends them; the snapshot puts the shared values back.
      post({ type: "snapshot", snapshot: library.snapshot });
      post({ type: "notice", kind: "info", text: READ_ONLY_NOTICE });
  }
}

async function copy(post: (m: HostToUi) => void, text: string, label: string | undefined): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    post({ type: "notice", kind: "ok", text: label ? `Copied ${label}` : "Copied" });
  } catch (err) {
    post({ type: "notice", kind: "error", text: `Could not copy: ${errorMessage(err)}` });
  }
}

/** Starts answering the UI on `endpoint`. */
export function attachShareHost(endpoint: HostEndpoint, ports: ShareHostPorts): () => void {
  const openedAt = new Date().toISOString();
  return endpoint.subscribe((m) => {
    try {
      answer(ports, m, (reply) => endpoint.post(reply), openedAt);
    } catch (err) {
      endpoint.post({ type: "notice", kind: "error", text: errorMessage(err) });
      void ports.log.error(MODULE, err, { type: m.type });
    }
  });
}
