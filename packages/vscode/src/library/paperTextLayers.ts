/** Checks papers for a text layer and gives scans one by OCR, recording the verdict on the paper. */
import {
  formatError,
  createPaperFiles,
  shouldWriteVerdict,
  deriveVerdictForDetection,
  deriveVerdictForError,
  deriveVerdictForOutcome,
} from "@labshelf/core";
import type { MutationContext, PaperRecord, TextLayerDetails, TextLayerOutcome, TextLayerSkipCode, PdfTextLayerBuilder, TextLayerHooks } from "@labshelf/core";
import type { PaperService } from "./paperService.js";

/** What happened when a paper was checked for, and possibly given, a text layer. */
export type CreateTextLayerResult =
  | { status: "added"; paper: PaperRecord; pagesAdded: number; pagesFailed: number }
  | { status: "not-needed" | "cancelled" }
  // skipped: needs OCR but was deliberately not read; unavailable: OCR failed.
  | { status: "skipped"; reason: string; code?: TextLayerSkipCode }
  | { status: "unavailable"; reason: string };

export class PaperTextLayers {
  constructor(
    private readonly ctx: MutationContext,
    private readonly papers: PaperService,
    // Absent when the text-layer support could not be built; every request then reports it unavailable.
    private readonly builder?: PdfTextLayerBuilder,
  ) {}

  /**
   * Gives a scanned paper a text layer and replaces paper.pdf with the result; whatever happens, the verdict is
   * recorded on the paper so the library can show it.
   * @returns what was done, or why nothing could be
   */
  async makeSearchable(paperId: string, hooks?: TextLayerHooks): Promise<CreateTextLayerResult> {
    if (!this.builder) { return { status: "unavailable", reason: "text layer support is not available" }; }
    const paper = await this.papers.findPaper(paperId);
    if (!paper) { return { status: "unavailable", reason: "paper not found" }; }
    // Without a PDF there is nothing to read, and a "failed" verdict would be bogus.
    if (!(await this.papers.pdfExists(paper))) { return { status: "skipped", reason: "it has no PDF" }; }

    let outcome: TextLayerOutcome;
    try {
      outcome = await this.builder.build(await this.readPdf(paper), hooks);
    } catch (error) {
      outcome = { status: "unavailable", reason: formatError(error) };
    }
    if (outcome.status !== "added") {
      await this.record(paperId, deriveVerdictForOutcome(outcome, this.ctx.now));
      return outcome;
    }

    // Reading a scan takes the better part of a minute, in which the paper may have been moved or removed.
    const current = await this.papers.findPaper(paperId);
    if (!current) { return { status: "unavailable", reason: "the paper was removed while it was being read" }; }
    await this.ctx.fs.writeFile(createPaperFiles(current.path, this.ctx.paths.join).pdf, outcome.bytes);
    const updated = await this.record(paperId, deriveVerdictForOutcome(outcome, this.ctx.now), { force: true });
    return { status: "added", paper: updated ?? current, pagesAdded: outcome.pagesAdded, pagesFailed: outcome.pagesFailed };
  }

  /**
   * Records whether a paper's PDF has text of its own, without reading any page optically.
   * @returns the updated paper, or undefined when it is unknown or there is no builder
   */
  async checkTextLayer(paperId: string): Promise<PaperRecord | undefined> {
    const paper = await this.papers.findPaper(paperId);
    if (!this.builder || !paper) { return undefined; }
    // A PDF-less paper stays clean: no verdict, no metadata.yaml rewrite, no event.
    if (!(await this.papers.pdfExists(paper))) { return paper; }
    let verdict: TextLayerDetails;
    try {
      verdict = deriveVerdictForDetection(await this.builder.detect(await this.readPdf(paper)), this.ctx.now);
    } catch (error) {
      verdict = deriveVerdictForError(error, this.ctx.now);
    }
    return this.record(paperId, verdict);
  }

  // Stores the verdict on the freshest copy of the record, so a status change or move made while a page was being
  // read is not undone.
  private async record(paperId: string, verdict: TextLayerDetails, options: { force?: boolean } = {}): Promise<PaperRecord | undefined> {
    const current = await this.papers.findPaper(paperId);
    if (!current) { return undefined; }
    if (!options.force && !shouldWriteVerdict(current.textLayer, verdict)) { return current; }
    return this.papers.rewriteRecord({ ...current, textLayer: verdict });
  }

  private readPdf(paper: PaperRecord): Promise<Uint8Array> {
    return this.ctx.fs.readFile(createPaperFiles(paper.path, this.ctx.paths.join).pdf);
  }
}
