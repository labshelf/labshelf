// Answers the library UI from the Mirror: the list comes from the snapshot, notes are read when opened, and every edit is refused. No PDF is ever requested.
import { derivePaperDetails, formatError, parseItemFile, type HostEndpoint, type HostToUi, type PaperNoteView, type UiToHost } from "@labshelf/core";

import { READ_ONLY_NOTICE } from "./mirrorFileSystem.js";
import type { buildRemoteSnapshot } from "./openLibrary.js";
import { remotePathFor } from "./openLibrary.js";
import type { OpenState } from "./remoteClient.js";
import { showNotes } from "./sourceView.js";

type RemoteLibraryClient = Extract<OpenState, { kind: "ready" }>["client"];
type RemoteLibrary = ReturnType<typeof buildRemoteSnapshot>;
const NO_PDF_NOTICE = "The remote library holds no PDFs.";

/** The paper's note items from its mirrored notes file; undefined when it has no notes row or the read fails. */
async function readNoteViews(client: RemoteLibraryClient, library: RemoteLibrary, id: string): Promise<PaperNoteView[] | undefined> {
  const path = remotePathFor(library, { kind: "notes", paperId: id });
  if (path === undefined) { return undefined; }
  try {
    const file = parseItemFile(await client.file(path));
    return file.segments.flatMap((s) => s.kind !== "item" ? [] : [{
      id: s.id, anchor: s.attrs.find(([key]) => key === "anchor")?.[1] ?? "", body: s.body, created: s.created ?? "", author: s.author ?? "",
    }]);
  } catch {
    return undefined;
  }
}

function answer(client: RemoteLibraryClient, library: RemoteLibrary, m: UiToHost, post: (m: HostToUi) => void): void {
  const known = (id: string) => {
    const paper = library.snapshot.papers.find((p) => p.id === id);
    if (!paper) { throw new Error(`The remote library has no paper ${id}`); }
    return paper;
  };
  switch (m.type) {
    case "ready": post({ type: "snapshot", snapshot: library.snapshot }); return;
    case "navigate": case "paper.selected": return;
    case "paper.details": {
      known(m.id);
      const id = m.id;
      const base = derivePaperDetails({ annotations: [] }, null);
      void readNoteViews(client, library, id).then((notes) => {
        post({ type: "details", id, details: notes ? { ...base, notes } : base });
      });
      return;
    }
    case "paper.files": known(m.id); post({ type: "files", id: m.id, state: { status: "ready", files: [] } }); return;
    case "paper.open": case "paper.openFile": known(m.id); post({ type: "notice", kind: "info", text: NO_PDF_NOTICE }); return;
    case "paper.openNotes": {
      const paper = known(m.id);
      const path = remotePathFor(library, { kind: "notes", paperId: m.id });
      if (path === undefined) { post({ type: "notice", kind: "info", text: "This paper has no notes." }); return; }
      showNotes(paper.title || m.id, () => client.file(path));
      return;
    }
    case "clipboard.write":
      navigator.clipboard.writeText(m.text).then(
        () => { post({ type: "notice", kind: "ok", text: m.label ? `Copied ${m.label}` : "Copied" }); },
        (err: unknown) => { post({ type: "notice", kind: "error", text: `Could not copy: ${formatError(err)}` }); },
      );
      return;
    default:
      // The UI applies status, tag and note edits before it sends them; the snapshot puts the mirrored values back.
      post({ type: "snapshot", snapshot: library.snapshot });
      post({ type: "notice", kind: "info", text: READ_ONLY_NOTICE });
  }
}

/** Starts answering the UI on `endpoint`; returns the unsubscribe. */
export function attachOpenHost(options: { client: RemoteLibraryClient; library: RemoteLibrary; endpoint: HostEndpoint }): () => void {
  const { client, library, endpoint } = options;
  return endpoint.subscribe((m) => {
    try {
      answer(client, library, m, (reply) => endpoint.post(reply));
    } catch (err) {
      endpoint.post({ type: "notice", kind: "error", text: formatError(err) });
    }
  });
}
