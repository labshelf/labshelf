// Answers the library UI from the Mirror: the list comes from the snapshot, notes are read and edited through core's notes store over the
// Mirror's file system, mirrored PDFs open in a tab, and edits of a paper's status, tags or metadata are refused.
import {
  addPaperNote, derivePaperDetails, editPaperNote, formatError, PaperNotesStore, removePaperNote, sendPaperDetails,
  type HostEndpoint, type HostToUi, type LibraryUiHost, type PaperFile, type UiToHost,
} from "@labshelf/core";

import type { MirrorFileSystem } from "./mirrorFileSystem.js";
import type { MirrorRow } from "./mirrorProjects.js";
import type { RemoteLibrary } from "./openLibrary.js";

const NO_PDF_NOTICE = "The remote library holds no PDF of this paper.";
const PAPER_EDIT_NOTICE = "A paper's status, tags and details cannot be changed in the remote library. Open LabShelf on your computer to change them.";
const NOTES_FILE = "notes.qmd";

/** What the host needs from the page. */
export interface OpenHostOptions {
  fs: MirrorFileSystem;
  rows: readonly MirrorRow[];
  library: RemoteLibrary;
  endpoint: HostEndpoint;
  /** Opens a PDF tab named `name` with the bytes `load` gives. */
  openPdf(name: string, load: () => Promise<Uint8Array>): void;
  /** Opens the notes file at `path` in an editable tab titled `title`. */
  openNotes(title: string, path: string): void;
}

/** The mirrored PDF rows directly in the paper's folder, paper.pdf first. */
function paperPdfs(rows: readonly MirrorRow[], dir: string): MirrorRow[] {
  const prefix = `${dir}/`;
  return rows.filter((row) => row.kind === "pdf" && row.path.startsWith(prefix) && !row.path.slice(prefix.length).includes("/"))
    .sort((a, b) => Number(b.path.endsWith("/paper.pdf")) - Number(a.path.endsWith("/paper.pdf")) || a.path.localeCompare(b.path));
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** core's library UI host over the Mirror: only the notes are writable; the other edits throw the paper notice. */
function createHost(options: OpenHostOptions): LibraryUiHost {
  const { fs, library, endpoint } = options;
  const dirOf = (paperId: string): string => {
    const paper = library.snapshot.papers.find((p) => p.id === paperId);
    if (!paper) { throw new Error(`The remote library has no paper ${paperId}`); }
    return paper.path;
  };
  const notesPath = (paperId: string): string => library.notePathOf(paperId) ?? `${dirOf(paperId)}/${NOTES_FILE}`;
  const refuse = async (): Promise<never> => { throw new Error(PAPER_EDIT_NOTICE); };
  return {
    papers: async (ids) => library.snapshot.papers.filter((p) => ids.includes(p.id)),
    post: (message) => { endpoint.post(message); },
    notice: (kind, text) => { endpoint.post({ type: "notice", kind, text }); },
    refresh: async () => { endpoint.post({ type: "snapshot", snapshot: library.snapshot }); },
    editTags: refuse, trashPapers: refuse, setTrashed: refuse, movePapers: refuse,
    folderName: () => undefined,
    details: async () => derivePaperDetails({ annotations: [] }, null),
    notes: new PaperNotesStore({
      read: async (paperId) => (await fs.exists(notesPath(paperId))) ? fs.readText(notesPath(paperId)) : null,
      write: (paperId, text) => fs.writeText(notesPath(paperId), text),
    }),
  };
}

function answer(host: LibraryUiHost, options: OpenHostOptions, m: UiToHost): void {
  const { fs, rows, library, openPdf, openNotes } = options;
  const known = (id: string) => {
    const paper = library.snapshot.papers.find((p) => p.id === id);
    if (!paper) { throw new Error(`The remote library has no paper ${id}`); }
    return paper;
  };
  const openRow = (row: MirrorRow): void => { openPdf(nameOf(row.path), () => fs.readFile(row.path)); };
  const fail = (err: unknown): void => { host.notice("error", formatError(err)); };
  switch (m.type) {
    case "ready": host.post({ type: "snapshot", snapshot: library.snapshot }); return;
    case "navigate": case "paper.selected": return;
    case "paper.details": known(m.id); void sendPaperDetails(host, m.id).catch(fail); return;
    case "paper.files": {
      const files: PaperFile[] = paperPdfs(rows, known(m.id).path).map((row) => ({
        name: nameOf(row.path), kind: "file", ...(row.size === undefined ? {} : { size: row.size }), modified: new Date(row.updated ?? 0).toISOString(),
      }));
      host.post({ type: "files", id: m.id, state: { status: "ready", files } });
      return;
    }
    case "paper.open": case "paper.openFile": {
      const pdfs = paperPdfs(rows, known(m.id).path);
      const row = m.type === "paper.open" ? pdfs[0] : pdfs.find((r) => nameOf(r.path) === m.name);
      if (row) { openRow(row); } else { host.notice("info", NO_PDF_NOTICE); }
      return;
    }
    case "paper.openNotes": {
      const paper = known(m.id);
      const path = library.notePathOf(m.id);
      if (path === undefined) { host.notice("info", "This paper has no notes."); return; }
      openNotes(paper.title || m.id, path);
      return;
    }
    case "paper.addNote": known(m.id); void addPaperNote(host, m.id, m.body).catch(fail); return;
    case "paper.editNote": known(m.id); void editPaperNote(host, m.id, m.itemId, m.body).catch(fail); return;
    case "paper.removeNote": known(m.id); void removePaperNote(host, m.id, m.itemId).catch(fail); return;
    case "clipboard.write":
      navigator.clipboard.writeText(m.text).then(
        () => { host.notice("ok", m.label ? `Copied ${m.label}` : "Copied"); },
        (err: unknown) => { host.notice("error", `Could not copy: ${formatError(err)}`); },
      );
      return;
    default:
      // The UI applies status, tag and detail edits before it sends them; the snapshot puts the mirrored values back.
      host.post({ type: "snapshot", snapshot: library.snapshot });
      host.notice("info", PAPER_EDIT_NOTICE);
  }
}

/** Starts answering the UI on `endpoint`; returns the unsubscribe. */
export function attachOpenHost(options: OpenHostOptions): () => void {
  const host = createHost(options);
  return options.endpoint.subscribe((m) => {
    try {
      answer(host, options, m);
    } catch (err) {
      options.endpoint.post({ type: "notice", kind: "error", text: formatError(err) } satisfies HostToUi);
    }
  });
}
