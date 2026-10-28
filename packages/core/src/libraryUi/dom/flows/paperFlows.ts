/**
 * The paper flows: the commands that need no dialog (open, attach, tags, status, notes, OCR, copy request), the tag prompt, the
 * folder and remove confirmations, copying citations, the move-folder picker, and revealing a paper wherever it lives.
 * The host does the work once the user agrees.
 */
import { PAPERS_DIR, type ReadingStatus, deriveBaseName, countPapersUnder, deriveParentDir, ROOT_LABEL, isUnderDir } from "../../../library/index.js";
import { hasMissingTextLayer, checkSiblingFolderName, listFolderPaths } from "../../folderModel.js";
import { listPapersUnder, deriveListView } from "../../listModel.js";
import type { UiContext } from "../uiContext.js";
import { askInputBox, askDialog, showDialog, pickQuickEntry } from "../../../ui/dom/index.js";
import { joinCitations, type CopyFormat } from "../../copy.js";
import type { CitationFormat } from "../../store/index.js";

export function openPaper(ctx: UiContext, id: string, page?: number): void {
  ctx.transport.post(page ? { type: "paper.open", id, page } : { type: "paper.open", id });
}

/** Opens a writing project's source at a zero-based line. */
export function openSource(ctx: UiContext, project: string, file: string, line: number): void {
  ctx.transport.post({ type: "project.openSource", project, file, line });
}

export function setReadingStatus(ctx: UiContext, ids: readonly string[], status: ReadingStatus): void {
  const byId = new Map(ctx.store.get().papers.map((p) => [p.id, p]));
  const changed = ids.filter((id) => byId.has(id) && byId.get(id)!.status !== status);
  if (changed.length === 0) return;
  ctx.store.applyStatus(changed, status);
  ctx.transport.post({ type: "paper.setStatus", ids: changed, status });
}

/** The tags in comma-separated `text`, trimmed, empty ones dropped. */
export function splitTags(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function updateTags(ctx: UiContext, ids: readonly string[], add: string[], remove: string[]): void {
  if (ids.length === 0 || (add.length === 0 && remove.length === 0)) return;
  ctx.store.applyTags(ids, add, remove);
  ctx.transport.post({ type: "paper.setTags", ids: [...ids], add, remove });
}

export function addNote(ctx: UiContext, id: string, body: string): void {
  ctx.transport.post({ type: "paper.addNote", id, body });
}

export function editNote(ctx: UiContext, id: string, itemId: string, body: string): void {
  ctx.transport.post({ type: "paper.editNote", id, itemId, body });
}

export function removeNote(ctx: UiContext, id: string, itemId: string): void {
  ctx.transport.post({ type: "paper.removeNote", id, itemId });
}

/** The papers among `ids` that OCR could fix and that are not queued yet. */
export function findFixablePapers(ctx: UiContext, ids: readonly string[]): string[] {
  const s = ctx.store.get();
  const wanted = new Set(ids);
  return listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).filter((p) => wanted.has(p.id) && hasMissingTextLayer(p) && !s.jobs[p.id]).map((p) => p.id);
}

export function createTextLayer(ctx: UiContext, ids: readonly string[]): void {
  if (ids.length === 0) return;
  ctx.store.queueJobs(ids);
  ctx.transport.post({ type: "paper.makeSearchable", ids: [...ids] });
}

/** Starts a PDF search unless one is already running for this paper; `replace` looks for a better version of its PDF. */
export function findPdf(ctx: UiContext, id: string, replace = false): void {
  if (ctx.store.get().pdfBusy.has(id)) return;
  ctx.transport.post(replace ? { type: "paper.findPdf", id, replace } : { type: "paper.findPdf", id });
}

/** The host finds an author address, opens the request email and records the day it was sent. */
export function sendCopyRequest(ctx: UiContext, id: string): void {
  ctx.transport.post({ type: "paper.askAuthor", id });
}

/** Must run inside the click that asked for it: the host opens a file picker, which browsers allow only in a gesture. */
export function attachPdf(ctx: UiContext, id: string): void {
  ctx.transport.post({ type: "paper.attachPdf", id });
}

type FileAction = "paper.openExternal" | "paper.reveal" | "paper.fetchMetadata" | "annotations.export";

/** Asks the host for one of its file actions on a paper. */
export function runHostFileAction(ctx: UiContext, type: FileAction, id: string): void {
  ctx.transport.post({ type, id });
}

export async function askAddTags(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const text = await askInputBox({
    title: ids.length > 1 ? `Tag ${ids.length} papers` : "Add tag",
    prompt: "Tag; commas add several",
    placeholder: "e.g. to-read",
  });
  if (text) updateTags(ctx, ids, splitTags(text), []);
}

export async function askCreateFolder(ctx: UiContext, parent: string): Promise<void> {
  const name = await askInputBox({
    title: parent === PAPERS_DIR ? "New folder" : `New folder in ${deriveBaseName(parent, "/")}`,
    prompt: "Folder name",
    placeholder: "e.g. Reading group",
    validate: (v) => checkSiblingFolderName(ctx.store.get(), parent, v),
  });
  if (name) ctx.transport.post({ type: "folder.create", parent, name });
}

export async function askRenameFolder(ctx: UiContext, path: string): Promise<void> {
  if (path === PAPERS_DIR) return;
  const current = deriveBaseName(path, "/");
  const parent = deriveParentDir(path, "/");
  const name = await askInputBox({
    title: "Rename folder",
    prompt: "New name",
    value: current,
    validate: (v) => checkSiblingFolderName(ctx.store.get(), parent, v, current),
  });
  if (name && name !== current) ctx.transport.post({ type: "folder.rename", path, name });
}

export async function askRemoveFolder(ctx: UiContext, path: string): Promise<void> {
  if (path === PAPERS_DIR) return;
  const count = countPapersUnder(ctx.store.get().papers.map((p) => p.path), path, "/");
  const ok = await askDialog(
    `Delete "${deriveBaseName(path, "/")}"?`,
    count > 0
      ? `The folder and the ${count} paper${count === 1 ? "" : "s"} inside it are deleted from the library on this device and on every synced device.`
      : "The folder is empty. It is deleted from the library on this device and on every synced device.",
    "Delete",
    true,
  );
  if (ok) ctx.transport.post({ type: "folder.delete", path });
}

export async function askRemove(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const wanted = new Set(ids);
  const papers = ctx.store.get().papers.filter((p) => wanted.has(p.id));
  if (papers.length === 0) return;
  const one = papers.length === 1;
  const choice = await showDialog({
    title: one ? `Remove "${papers[0]!.title}" from the library?` : `Remove ${papers.length} papers from the library?`,
    message: one
      ? "Its folder and files are deleted from the library on this device and on every synced device."
      : "Their folders and files are deleted from the library on this device and on every synced device.",
    severity: "danger",
    buttons: [{ id: "remove", label: "Remove", primary: true, danger: true }],
  });
  if (choice !== "remove") return;
  ctx.store.clearSelection();
  ctx.transport.post({ type: "paper.remove", ids: papers.map((p) => p.id) });
}

export const CITE_LABEL: Record<CitationFormat, string> = { bibtex: "BibTeX", apa: "APA", mla: "MLA", chicago: "Chicago", inText: "In-text" };

const COPIED_LABEL: Record<CopyFormat, string> = {
  key: "cite key", bibtex: "BibTeX", apa: "APA reference", mla: "MLA reference", chicago: "Chicago reference", inText: "in-text citation",
};

/** Copies the given papers, in list order; keys are comma-joined, ready for a citation command. */
export function copyCitation(ctx: UiContext, ids: readonly string[], format: CopyFormat): void {
  const wanted = new Set(ids);
  const papers = ctx.store.get().papers.filter((p) => wanted.has(p.id));
  if (papers.length === 0) return;
  const label = papers.length === 1 ? COPIED_LABEL[format] : `${papers.length} × ${COPIED_LABEL[format]}`;
  ctx.transport.post({ type: "clipboard.write", text: joinCitations(papers, format), label });
}

/** Copies any text the pane shows, such as a DOI or the abstract. */
export function copyText(ctx: UiContext, text: string, label: string): void {
  if (text) ctx.transport.post({ type: "clipboard.write", text, label });
}

export async function pickMoveFolder(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const items = [{ label: ROOT_LABEL, path: PAPERS_DIR }, ...listFolderPaths(ctx.store.get().folders)]
    .map((f) => ({ label: f.label, icon: (f.path === PAPERS_DIR ? "library" : "folder") as "library" | "folder", value: f.path }));
  const target = await pickQuickEntry(items, { placeholder: `Move ${ids.length === 1 ? "paper" : `${ids.length} papers`} to…` });
  if (target) ctx.transport.post({ type: "paper.move", ids: [...ids], target });
}

export function showPaper(ctx: UiContext, id: string): void {
  const s = ctx.store.get();
  const paper = s.papers.find((p) => p.id === id);
  if (!paper) return;
  if (s.folder !== PAPERS_DIR && !isUnderDir(paper.path, s.folder, "/")) ctx.store.openFolder(deriveParentDir(paper.path, "/"));
  else if (!deriveListView(ctx.store.get()).rows.some((p) => p.id === id)) {
    ctx.store.set({ query: "" });
  }
  ctx.store.selectOnly(id);
  ctx.store.openPaper(id);
  [...ctx.root.querySelectorAll<HTMLElement>(".paper-row")].find((r) => r.dataset["id"] === id)?.scrollIntoView({ block: "center" });
}
