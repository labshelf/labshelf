// Handles the UI's PDF requests: open in the reader, search the web, attach a local file, open the page in the way.
// INVARIANT: PDF bytes never cross runtime messaging; the page and the background write IndexedDB themselves.
import { PDF_FILE, errorMessage, isPdfBytes, pdfSourceLabel, type PdfAccess } from "@labshelf/core";
import { attachPdfToPaper } from "../../../capture";
import { sendRuntime, type AttachPdfData } from "../../../platform";
import { openReader } from "../../../reader/access";
import { IndexedDbFileSystem } from "../../../storage";
import type { HostContext } from "../hostContext";
import { scheduleSyncSoon } from "../runtimeRequests";

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
}

async function ingestLocalPdf(ctx: HostContext, id: string, file: File): Promise<void> {
  if (file.size > MAX_PDF_BYTES) { ctx.notice("error", "That file is larger than 120 MB."); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfBytes(bytes)) { ctx.notice("error", "That file does not look like a PDF."); return; }
  // attachPdfToPaper re-reads the record's current path, so a move during the pick cannot orphan the file, and it
  // refuses to overwrite a PDF that arrived by sync meanwhile.
  const { written } = await attachPdfToPaper(ctx.mutations, id, bytes);
  await ctx.snapshots.refresh();
  if (!written) { ctx.notice("info", "This paper already has a PDF."); return; }
  scheduleSyncSoon(ctx.log, "paper.attach");
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

export function createPdfHandlers(ctx: HostContext): PdfHandlers {
  const fs = new IndexedDbFileSystem();
  const searching = new Set<string>();
  return {
    async open(id) {
      const paper = ctx.papers([id])[0];
      if (!paper) return;
      // A key can exist with zero or corrupt bytes, so the header is checked before the reader opens.
      const pdfPath = `${paper.path}/${PDF_FILE}`;
      const bytes = (await fs.stat(pdfPath)) ? await fs.readFile(pdfPath).catch(() => undefined) : undefined;
      if (!bytes || !isPdfBytes(bytes)) { ctx.endpoint.post({ type: "pdf.missing", id }); return; }
      await openReader(paper.id);
    },
    async find(id, replace) {
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
    },
    attach(id) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pdf,application/pdf";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) void ingestLocalPdf(ctx, id, file).catch((err: unknown) => ctx.notice("error", errorMessage(err)));
      });
      input.click();
    },
    async openForPdf(id, access) {
      await sendRuntime<{ opened: true }>({ type: "paper.openForPdf", id, access });
      const step = access.kind === "login" ? "sign in" : "pass the check";
      ctx.notice("info", `When you ${step} in the new tab, LabShelf attaches the PDF on its own.`);
    },
  };
}
