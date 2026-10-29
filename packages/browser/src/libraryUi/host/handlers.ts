/**
 * Answers the library page UI's messages: paper changes (status, tags, note, move, remove, clipboard), a paper's detail and
 * annotations export, folder create/rename/delete, adding a paper from an open tab, the file tray and the PDF requests.
 * Each change goes through the core library mutations and posts a fresh snapshot; the paper changes shared with VS Code run in
 * core over createLibraryUiHost.
 * INVARIANT: PDF bytes never cross runtime messaging; the page and the background write the library files themselves.
 */
import {
  PAPERS_DIR, PDF_FILE, deriveBaseName, deriveParentDir, formatAnnotationsMarkdown, formatError, formatKeptFieldNotice, formatPdfSourceLabel,
  hostOf, isPdfBytes, isUnderDir, type LibraryFileSystem, type LibraryUiHost, type MissingPdfAction, type PaperRecord, type PdfAccess, type ReadingStatus, type Reference,
} from "@labshelf/core";
import { attachPdfToPaper } from "../../capture";
import {
  bx, downloadTextFile, sendRuntime, type AttachPdfReply, type BrowserTab, type CopyRequestReply, type WriteOutcome,
} from "../../platform";
import { openReader } from "../reader";
import { createLibraryFileSystem } from "../../storage";
import type { HostContext } from "./context";

const deriveReferences = (papers: readonly PaperRecord[]): Reference[] => papers.map((p) => ({ id: p.id, path: p.path }));

// ---- Paper changes

export async function setReadingStatus(ctx: HostContext, ids: readonly string[], status: ReadingStatus): Promise<void> {
  const changed = ctx.papers(ids).filter((p) => p.status !== status);
  if (changed.length === 0) return;
  const { failed } = await ctx.mutations.setStatus(deriveReferences(changed), status);
  await ctx.snapshots.refresh();
  if (failed.length) ctx.notice("error", formatKeptFieldNotice("status", failed.length, failed[0]!.error));
}

/** The port the core paper handlers (tags, note, move, remove, details) answer the UI through; changes go only to papers the snapshot knows. */
export function createLibraryUiHost(ctx: HostContext): LibraryUiHost {
  return {
    papers: async (ids) => ctx.papers(ids),
    post: (m) => ctx.endpoint.post(m),
    notice: ctx.notice,
    refresh: () => ctx.snapshots.refresh(),
    editTags: (ids, add, remove) => ctx.mutations.editTags(deriveReferences(ctx.papers(ids)), add, remove),
    notes: ctx.notes,
    trashPapers: (papers) => ctx.mutations.trashPapers(deriveReferences(papers)),
    movePapers: (ids, target) => ctx.mutations.movePapers(deriveReferences(ctx.papers(ids)), target),
    folderName: (target) => (target === PAPERS_DIR ? undefined : deriveBaseName(target, "/")),
    details: (paper) => ctx.sidecars.details(paper),
  };
}

/** `label` names what was copied ("2 × cite key"); without it the notice quotes the text. */
export async function writeClipboard(ctx: HostContext, text: string, label?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ctx.notice("ok", label ? `Copied ${label}` : `Copied: ${text}`);
  } catch (err) {
    ctx.notice("error", `Clipboard blocked — ${formatError(err)}`);
  }
}

// ---- Detail pane and annotations export

export async function exportAnnotations(ctx: HostContext, id: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  if (!paper) return;
  const { annotations } = await ctx.sidecars.details(paper);
  if (annotations.length === 0) { ctx.notice("info", "This paper has no annotations to export."); return; }
  await downloadTextFile(`${paper.citeKey}-annotations.md`, formatAnnotationsMarkdown(paper, annotations), "text/markdown");
}

// ---- Folders

export async function createFolder(ctx: HostContext, parent: string, name: string): Promise<void> {
  const target = await ctx.mutations.createFolder(parent, name);
  await ctx.snapshots.refresh();
  ctx.endpoint.post({ type: "navigate", folder: target });
}

export async function renameFolder(ctx: HostContext, oldPath: string, name: string): Promise<void> {
  const newPath = await ctx.mutations.renameFolder(oldPath, name);
  await ctx.snapshots.refresh();
  if (isUnderDir(ctx.folder, oldPath, "/")) ctx.endpoint.post({ type: "navigate", folder: newPath + ctx.folder.slice(oldPath.length) });
}

export async function removeFolder(ctx: HostContext, path: string): Promise<void> {
  await ctx.mutations.trashFolder(path);
  await ctx.snapshots.refresh();
  if (isUnderDir(ctx.folder, path, "/")) ctx.endpoint.post({ type: "navigate", folder: deriveParentDir(path, "/") });
  ctx.notice("ok", `Deleted ${deriveBaseName(path, "/")}`);
}

// ---- Add from an open tab

export async function offerOpenTabs(ctx: HostContext, folder: string): Promise<void> {
  const tabs = await sendRuntime<BrowserTab[]>({ type: "tabs.list" });
  if (tabs.length === 0) { ctx.notice("info", "Open the paper's page in another tab first, then click Add again."); return; }
  const sources = tabs.map((t) => ({ id: String(t.id), label: t.title || t.url, description: hostOf(t.url) }));
  ctx.endpoint.post({ type: "add.sources", folder, sources });
}

export async function addTabPaper(ctx: HostContext, folder: string, sourceId: string, ifNoPdf: MissingPdfAction, retryPdf: boolean): Promise<void> {
  const key = `add:${sourceId}`;
  ctx.endpoint.post({ type: "progress", key, text: retryPdf ? "Searching for the PDF…" : "Capturing paper…" });
  let result: WriteOutcome;
  try {
    result = await sendRuntime<WriteOutcome>({ type: "capture.tab", tabId: Number(sourceId), targetFolder: folder, ifNoPdf, ...(retryPdf ? { retryPdf } : {}) });
  } finally {
    ctx.endpoint.post({ type: "progress", key, text: null });
  }
  if (result.status === "no-pdf") {
    ctx.endpoint.post({ type: "add.noPdf", folder, sourceId, title: result.title, miss: result.miss });
    return;
  }
  await ctx.snapshots.refresh();
  ctx.endpoint.post({ type: "select", id: result.id });
  if (result.alreadyInLibrary) ctx.notice("info", `Already in your library — "${result.title}"`);
  else ctx.notice("ok", result.pdfSource ? `Added "${result.title}" (PDF via ${formatPdfSourceLabel(result.pdfSource)})` : `Added "${result.title}" — saved without a PDF`);
}

// ---- File tray

export interface PaperFileHandlers {
  list(id: string): Promise<void>;
  describe(id: string, name: string, description: string): Promise<void>;
  open(id: string, name: string): Promise<void>;
  copyPath(id: string, name: string): Promise<void>;
}

// File messages name one direct entry of the paper folder, so a name that leaves it is refused.
function isEntryName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/");
}

/** The paper and entry a file message names, or undefined after telling the user and logging why. */
function resolveEntry(ctx: HostContext, id: string, name: string, action: string): PaperRecord | undefined {
  const [paper] = ctx.papers([id]);
  if (paper && isEntryName(name)) return paper;
  void ctx.log.log("WARN", "libraryUi", "File message refused", { action, id, name, knownPaper: !!paper });
  ctx.notice("error", paper ? `"${name}" is not a file of this paper.` : "That paper is no longer in the library.");
  return undefined;
}

async function listFiles(ctx: HostContext, id: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  if (!paper) {
    void ctx.log.log("WARN", "libraryUi", "File listing asked for an unknown paper", { id });
    ctx.endpoint.post({ type: "files", id, state: { status: "failed", message: "That paper is no longer in the library." } });
    return;
  }
  ctx.endpoint.post({ type: "files", id, state: await ctx.mutations.listFiles(paper) });
}

async function describeFile(ctx: HostContext, id: string, name: string, description: string): Promise<void> {
  const paper = resolveEntry(ctx, id, name, "describe");
  if (!paper) return;
  try {
    const written = await ctx.mutations.describeFile({ id: paper.id, path: paper.path }, name, description);
    if (!written) throw new Error(`no paper in ${paper.path}`);
  } catch (err) {
    void ctx.log.error("libraryUi", err, { action: "describeFile", id, name });
    ctx.notice("error", `Could not save the description — ${formatError(err)}`);
    return;
  }
  await ctx.snapshots.refresh();
  await listFiles(ctx, id);
}

async function openFile(ctx: HostContext, fs: LibraryFileSystem, openPdf: (id: string) => Promise<void>, id: string, name: string): Promise<void> {
  const paper = resolveEntry(ctx, id, name, "open");
  if (!paper) return;
  if (name === PDF_FILE) { await openPdf(id); return; }
  const path = `${paper.path}/${name}`;
  const bytes = (await fs.stat(path)) ? await fs.readFile(path) : undefined;
  if (!bytes) {
    void ctx.log.log("WARN", "libraryUi", "File to open is missing", { id, name });
    ctx.notice("error", `"${name}" is no longer in this paper's folder.`);
    return;
  }
  // PLATFORM: the blob URL lives as long as this page, which the new tab needs while it loads.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  await bx.tabs.create({ url });
}

/** `openPdf` is the reader route paper.pdf takes, the same one the paper's Open uses. */
export function createPaperFileHandlers(ctx: HostContext, openPdf: (id: string) => Promise<void>): PaperFileHandlers {
  const fs = createLibraryFileSystem();
  return {
    list: (id) => listFiles(ctx, id),
    describe: (id, name, description) => describeFile(ctx, id, name, description),
    open: (id, name) => openFile(ctx, fs, openPdf, id, name),
    async copyPath(id, name) {
      const paper = resolveEntry(ctx, id, name, "copyPath");
      if (paper) await writeClipboard(ctx, `${paper.path}/${name}`);
    },
  };
}

// ---- PDF

/** Local PDFs above this size are refused, matching the fetch layer's cap. */
const MAX_PDF_BYTES = 120 * 1024 * 1024;

export interface PdfHandlers {
  open(id: string): Promise<void>;
  /** `replace` looks for a better version of the paper's preprint or accepted PDF and replaces it. */
  find(id: string, replace: boolean): Promise<void>;
  /** Opens the file picker synchronously, so it must be called inside the user's click. */
  attach(id: string): void;
  /** Opens the sign-in or bot-check page in a tab the background watches for the PDF. */
  openForPdf(id: string, access: PdfAccess): Promise<void>;
  /** Opens the request email to the paper's authors, or its article page when no address is found. */
  askAuthor(id: string): Promise<void>;
}

const ASK_AUTHOR_NOTICE: Record<CopyRequestReply["opened"], [kind: "ok" | "info" | "error", text: string]> = {
  mail: ["ok", "The request email is open in your mail client."],
  article: ["info", "No author address was found, so the article page is open. Look for a contact there."],
  none: ["error", "No author address or article page is known for this paper."],
};

async function ingestLocalPdf(ctx: HostContext, id: string, file: File): Promise<void> {
  if (file.size > MAX_PDF_BYTES) { ctx.notice("error", "That file is larger than 120 MB."); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfBytes(bytes)) { ctx.notice("error", "That file does not look like a PDF."); return; }
  // attachPdfToPaper re-reads the record's current path, so a move during the pick cannot orphan the file, and it
  // refuses to overwrite a PDF that arrived meanwhile.
  const { written } = await attachPdfToPaper(ctx.mutations, id, bytes);
  await ctx.snapshots.refresh();
  if (!written) { ctx.notice("info", "This paper already has a PDF."); return; }
  ctx.notice("ok", "PDF attached");
}

async function reportFind(ctx: HostContext, id: string, result: AttachPdfReply, replace: boolean): Promise<void> {
  if (replace) {
    if (result.attached) await ctx.snapshots.refresh();
    if (result.attached) ctx.notice("ok", `PDF replaced with a better version (via ${formatPdfSourceLabel(result.source)})`);
    else ctx.notice("info", "No published version found. The PDF you have stays.");
    return;
  }
  if (result.attached || result.alreadyHadPdf) {
    await ctx.snapshots.refresh();
    if (result.attached) ctx.notice("ok", `PDF attached (via ${formatPdfSourceLabel(result.source)})`);
    else ctx.notice("info", "This paper already has a PDF.");
    return;
  }
  ctx.endpoint.post({ type: "pdf.findResult", id, miss: result.miss ?? { tried: 0, sources: [], blocked: false, needsLogin: false } });
}

async function openPdf(ctx: HostContext, fs: LibraryFileSystem, id: string): Promise<void> {
  const paper = ctx.papers([id])[0];
  if (!paper) return;
  // A key can exist with zero or corrupt bytes, so the header is checked before the reader opens.
  const pdfPath = `${paper.path}/${PDF_FILE}`;
  const bytes = (await fs.stat(pdfPath)) ? await fs.readFile(pdfPath).catch(() => undefined) : undefined;
  if (!bytes || !isPdfBytes(bytes)) { ctx.endpoint.post({ type: "pdf.missing", id }); return; }
  await openReader(paper.id);
}

async function findPdfOnline(ctx: HostContext, searching: Set<string>, id: string, replace: boolean): Promise<void> {
  if (searching.has(id) || ctx.papers([id]).length === 0) return;
  searching.add(id);
  ctx.endpoint.post({ type: "pdf.busy", id, busy: true });
  ctx.endpoint.post({ type: "progress", key: `find:${id}`, text: replace ? "Looking for the published version…" : "Looking for the PDF…" });
  let result: AttachPdfReply;
  try {
    result = await sendRuntime<AttachPdfReply>(replace ? { type: "paper.findPdf", id, replace } : { type: "paper.findPdf", id });
  } finally {
    searching.delete(id);
    ctx.endpoint.post({ type: "progress", key: `find:${id}`, text: null });
    ctx.endpoint.post({ type: "pdf.busy", id, busy: false });
  }
  await reportFind(ctx, id, result, replace);
}

function pickLocalPdf(ctx: HostContext, id: string): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void ingestLocalPdf(ctx, id, file).catch((err: unknown) => ctx.notice("error", formatError(err)));
  });
  input.click();
}

export function createPdfHandlers(ctx: HostContext): PdfHandlers {
  const fs = createLibraryFileSystem();
  const searching = new Set<string>();
  return {
    open: (id) => openPdf(ctx, fs, id),
    find: (id, replace) => findPdfOnline(ctx, searching, id, replace),
    attach: (id) => pickLocalPdf(ctx, id),
    async openForPdf(id, access) {
      await sendRuntime<{ opened: true }>({ type: "paper.openForPdf", id, access });
      const step = access.kind === "login" ? "sign in" : "pass the check";
      ctx.notice("info", `When you ${step} in the new tab, LabShelf attaches the PDF on its own.`);
    },
    async askAuthor(id) {
      ctx.endpoint.post({ type: "progress", key: `author:${id}`, text: "Looking for the author's address…" });
      try {
        const { opened } = await sendRuntime<CopyRequestReply>({ type: "paper.askAuthor", id });
        if (opened === "mail") await ctx.snapshots.refresh();
        ctx.notice(...ASK_AUTHOR_NOTICE[opened]);
      } finally {
        ctx.endpoint.post({ type: "progress", key: `author:${id}`, text: null });
      }
    },
  };
}
