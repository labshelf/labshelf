// Handles the UI's PDF requests: open in the reader, search the web, attach a local file, open the page in the way,
// ask the authors for a copy.
// INVARIANT: PDF bytes never cross runtime messaging; the page and the background write IndexedDB themselves.
import { PDF_FILE, errorMessage, isPdfBytes, pdfSourceLabel, type LibraryFileSystem, type PdfAccess } from "@labshelf/core";
import { attachPdfToPaper } from "../../../capture";
import { sendRuntime, type AskAuthorData, type AttachPdfData } from "../../../platform";
import { openReader } from "../../../reader/access";
import { createLibraryFileSystem } from "../../../storage";
import type { HostContext } from "../hostContext";

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

const ASK_AUTHOR_NOTICE: Record<AskAuthorData["opened"], [kind: "ok" | "info" | "error", text: string]> = {
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

async function reportFind(ctx: HostContext, id: string, result: AttachPdfData, replace: boolean): Promise<void> {
  if (replace) {
    if (result.attached) await ctx.snapshots.refresh();
    if (result.attached) ctx.notice("ok", `PDF replaced with a better version (via ${pdfSourceLabel(result.source)})`);
    else ctx.notice("info", "No published version found. The PDF you have stays.");
    return;
  }
  if (result.attached || result.alreadyHadPdf) {
    await ctx.snapshots.refresh();
    if (result.attached) ctx.notice("ok", `PDF attached (via ${pdfSourceLabel(result.source)})`);
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
  let result: AttachPdfData;
  try {
    result = await sendRuntime<AttachPdfData>(replace ? { type: "paper.findPdf", id, replace } : { type: "paper.findPdf", id });
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
    if (file) void ingestLocalPdf(ctx, id, file).catch((err: unknown) => ctx.notice("error", errorMessage(err)));
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
        const { opened } = await sendRuntime<AskAuthorData>({ type: "paper.askAuthor", id });
        if (opened === "mail") await ctx.snapshots.refresh();
        ctx.notice(...ASK_AUTHOR_NOTICE[opened]);
      } finally {
        ctx.endpoint.post({ type: "progress", key: `author:${id}`, text: null });
      }
    },
  };
}
