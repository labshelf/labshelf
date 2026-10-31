// Answers the library UI's paper changes shared by every host (tags, note, move, remove, the detail pane) over the LibraryUiHost port each app builds.
import type { PaperRecord } from "../model/index.js";
import { createCellRuns, type CellLanguage, type CellRequest, type PaperNotesStore, type RunCellPort } from "../qmd/index.js";
import type { HostToUi, PaperDetails, PaperNoteView } from "./protocol/index.js";
import { deriveCleanTags, formatKeptFieldNotice, moveNotice, removeNotice, titleResolver, type BatchError } from "./copy.js";

/** What the shared paper handlers need from the app hosting the library UI. */
export interface LibraryUiHost {
  /** The records of `ids` that exist, in the order given. */
  papers(ids: readonly string[]): Promise<readonly PaperRecord[]>;
  post(message: HostToUi): void | Promise<void>;
  notice(kind: "info" | "ok" | "error", text: string): void;
  /** Pushes the library to the UI again after a change; a no-op where the library pushes its own changes. */
  refresh(): Promise<void>;
  /** `add` and `remove` are already trimmed. */
  editTags(ids: readonly string[], add: string[], remove: string[]): Promise<{ failed: readonly BatchError[] }>;
  /** The paper notes; a host without it serves read-only notes. */
  readonly notes?: PaperNotesStore;
  trashPapers(papers: readonly PaperRecord[]): Promise<{ done: readonly string[]; failed: readonly BatchError[] }>;
  movePapers(ids: readonly string[], target: string): Promise<{ done: readonly string[]; failed: readonly BatchError[] }>;
  /** The folder name a move notice shows, or undefined for the library root. */
  folderName(target: string): string | undefined;
  details(paper: PaperRecord): Promise<PaperDetails>;
  /** Runs a note's code cell; absent means the host has no runner and the notes show no Run button. */
  readonly runCell?: RunCellPort;
  /** Restarts one note's process for a language; absent where the host has no runner. */
  readonly restartCell?: (noteKey: string, language: CellLanguage) => Promise<void>;
  /** Installs the Python that cells run with, as the missing-python prompt asks. */
  installPython?(): void;
}

/** Request ids are made by each view, so one registry serves every library UI host. */
const paperRuns = createCellRuns();

/** The D2 note key: the cells of one paper's notes share a process per language. */
const paperNoteKey = (id: string): string => `paper:${id}`;

export async function setPaperTags(host: LibraryUiHost, ids: readonly string[], add: readonly string[], remove: readonly string[]): Promise<void> {
  const { failed } = await host.editTags(ids, deriveCleanTags(add), deriveCleanTags(remove));
  await host.refresh();
  const first = failed[0];
  if (first) host.notice("error", formatKeptFieldNotice("tags", failed.length, first.error));
}

async function changeNotes(host: LibraryUiHost, run: (notes: PaperNotesStore) => Promise<void>): Promise<boolean> {
  if (!host.notes) return false;
  try { await run(host.notes); return true; } catch (error) {
    host.notice("error", `The note could not be saved — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function addPaperNote(host: LibraryUiHost, id: string, body: string): Promise<void> {
  if (await changeNotes(host, async (notes) => { await notes.addItem(id, { body }); })) await sendPaperDetails(host, id);
}

/** Does not resend the details: the open editor holds the text. */
export async function editPaperNote(host: LibraryUiHost, id: string, itemId: string, body: string): Promise<void> {
  await changeNotes(host, (notes) => notes.editItem(id, itemId, body));
}

export async function removePaperNote(host: LibraryUiHost, id: string, itemId: string): Promise<void> {
  if (await changeNotes(host, (notes) => notes.removeItem(id, itemId))) await sendPaperDetails(host, id);
}

/** Moves paper folders under `target`; the titles in the notice are looked up after the move. */
export async function movePaperFolders(host: LibraryUiHost, ids: readonly string[], target: string): Promise<void> {
  const { done, failed } = await host.movePapers(ids, target);
  if (done.length) await host.refresh();
  const notice = moveNotice(done.length, failed, host.folderName(target), titleResolver(await host.papers(ids)));
  if (notice) host.notice(notice.kind, notice.text);
}

export async function removePapers(host: LibraryUiHost, ids: readonly string[]): Promise<void> {
  const papers = await host.papers(ids);
  const { done, failed } = await host.trashPapers(papers);
  await host.refresh();
  const notice = removeNotice(done, failed, titleResolver(papers));
  if (notice) host.notice(notice.kind, notice.text);
}

export async function sendPaperDetails(host: LibraryUiHost, id: string): Promise<void> {
  const [paper] = await host.papers([id]);
  if (!paper) return;
  const details = await host.details(paper);
  const notes = host.notes ? await readNoteViews(host.notes, id) : undefined;
  const canRunCells = !!(notes && host.runCell);
  const payload = notes ? { ...details, notes, ...(canRunCells ? { canRunCells } : {}) } : details;
  await host.post({ type: "details", id, details: payload, ...(canRunCells ? { canRunCells } : {}) });
}

/** Runs a note's cell, stores its output with the note, resends the details, then answers `paper.cellState`. */
export async function runPaperCell(host: LibraryUiHost, msg: { id: string; itemId: string; label: string; code: string; language: CellLanguage; requestId: string; params?: CellRequest["params"]; preview?: boolean }): Promise<void> {
  const { id, itemId, label, code, language, requestId, params, preview } = msg;
  const notes = host.notes;
  await paperRuns.run(notes ? host.runCell : undefined, { label, code, language, requestId, noteKey: paperNoteKey(id), ...(params ? { params } : {}), ...(preview ? { preview } : {}) }, {
    read: async () => {
      const item = notes ? (await notes.read(id)).segments.find((s) => s.kind === "item" && s.id === itemId) : undefined;
      return item?.kind === "item" ? item.body : undefined;
    },
    write: (body) => notes ? notes.editItem(id, itemId, body) : Promise.resolve(),
    push: () => sendPaperDetails(host, id),
    post: (state) => { void host.post({ type: "paper.cellState", requestId, state }); },
    preview: (result) => { void host.post({ type: "paper.cellPreview", requestId, result }); },
    fail: (error) => { host.notice("error", `The cell could not run — ${error instanceof Error ? error.message : String(error)}`); },
  });
}

/** Restarts the `language` process of the paper's notes; a host without a runner restarts nothing. */
export async function restartPaperCell(host: LibraryUiHost, msg: { id: string; language: CellLanguage }): Promise<void> {
  await host.restartCell?.(paperNoteKey(msg.id), msg.language);
}

export function cancelPaperCell(requestId: string): void {
  paperRuns.cancel(requestId);
}

export function installPaperPython(host: LibraryUiHost): void {
  host.installPython?.();
}

async function readNoteViews(store: PaperNotesStore, id: string): Promise<PaperNoteView[]> {
  const file = await store.read(id);
  return file.segments.flatMap((s) => s.kind !== "item" ? [] : [{
    id: s.id, anchor: s.attrs.find(([key]) => key === "anchor")?.[1] ?? "", body: s.body, created: s.created ?? "", author: s.author ?? "",
  }]);
}
