/** Changes and reads papers already in the library: disk first through the core mutations, then the index and its events. */
import * as vscode from "vscode";

import { editPaperTags, movePapers, paperFiles, trashPapers, updatePaperFields, withResolvedMetadata, writePaperRecord } from "@labshelf/core";
import type { BatchOutcome, LibraryStore, MoveOutcome, MutationContext, PaperFieldsPatch, PaperRecord, PaperRef, PdfParse, RecordMetadata } from "@labshelf/core";
import { EVENTS, EventBus } from "../events/index.js";
import type { ReindexSummary } from "../storage/data/index.js";

export class PaperService {
  constructor(
    private readonly ctx: MutationContext,
    private readonly store: LibraryStore,
    private readonly reindex: () => Promise<ReindexSummary>,
    private readonly eventBus: EventBus,
    private readonly parse: PdfParse,
  ) {}

  listPapers(): Promise<PaperRecord[]> {
    return Promise.resolve([...this.store.snapshot.papers.values()].map((entry) => entry.record));
  }

  findPaper(paperId: string): Promise<PaperRecord | undefined> {
    return Promise.resolve(this.store.snapshot.papers.get(paperId)?.record);
  }

  /** @returns every paper no registry confirmed, worth re-resolving or filling in by hand */
  async listUnresolvedPapers(): Promise<PaperRecord[]> {
    return (await this.listPapers()).filter((paper) => !paper.doi);
  }

  /** @returns the paper's paper.pdf, or null when the id is unknown or the paper has no PDF */
  async resolvePdfUri(paperId: string): Promise<vscode.Uri | null> {
    const paper = await this.findPaper(paperId);
    if (!paper || paper.hasPdf === false || !(await this.pdfExists(paper))) {
      return null;
    }
    return vscode.Uri.file(paperFiles(paper.path, this.ctx.paths.join).pdf);
  }

  // Asked at action time rather than trusting the indexed flag. FileType is a bit flag and the indexer counts a
  // symlinked PDF (File|SymbolicLink) as present, so this does too; otherwise reconcilePdf would undo the indexer.
  async pdfExists(paper: PaperRecord): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(paperFiles(paper.path, this.ctx.paths.join).pdf));
      return (stat.type & vscode.FileType.File) !== 0;
    } catch {
      return false;
    }
  }

  /**
   * Corrects a stale hasPdf flag in the index; hasPdf is derived, so metadata.yaml is never touched.
   * @returns the current record and its real hasPdf, or undefined when the paper is unknown
   */
  async reconcilePdf(paperId: string): Promise<{ paper: PaperRecord; hasPdf: boolean } | undefined> {
    const current = await this.findPaper(paperId);
    if (!current) { return undefined; }
    const hasPdf = await this.pdfExists(current);
    if (current.hasPdf === hasPdf) { return { paper: current, hasPdf }; }
    const updated: PaperRecord = { ...current, hasPdf };
    // This check runs on every "open PDF" command, so it must stay cheap: announce the correction directly instead
    // of a full reindex. The store's own hasPdf self-corrects on the next real reload, same as any other transient
    // staleness window the store already has.
    this.announceUpdate(updated);
    return { paper: updated, hasPdf };
  }

  updatePaperStatus(paperId: string, status: PaperRecord["status"]): Promise<PaperRecord | undefined> {
    return this.updatePaperFields(paperId, { status });
  }

  /** @returns the paper after the patch, or undefined when it is unknown or its folder holds no paper */
  async updatePaperFields(paperId: string, patch: PaperFieldsPatch): Promise<PaperRecord | undefined> {
    const current = await this.findPaper(paperId);
    const written = current && (await updatePaperFields(this.ctx, current.path, patch));
    if (!current || !written) { return undefined; }
    const { next, changed } = this.resolveOwnedFields(current, written);
    if (changed) { await this.reindex(); }
    return next;
  }

  /** Adds and removes tags on several papers. @returns the papers changed and the failures */
  async editTags(paperIds: string[], add: string[], remove: string[]): Promise<BatchOutcome> {
    const { refs, unknown } = this.refsFor(paperIds);
    const outcome = await editPaperTags(this.ctx, refs.map(({ paper }) => paper), add, remove);
    let anyChanged = false;
    for (const written of outcome.records) {
      const current = refs.find(({ paper }) => paper.id === written.id)?.record;
      if (current && this.resolveOwnedFields(current, written).changed) { anyChanged = true; }
    }
    // One reindex for the whole batch, not one per paper.
    if (anyChanged) { await this.reindex(); }
    return { done: outcome.done, failed: [...unknown, ...outcome.failed] };
  }

  /** Overwrites a paper's bibliographic fields with resolved ones. @returns the updated paper, or undefined when unknown */
  async applyResolvedMetadata(paperId: string, metadata: RecordMetadata): Promise<PaperRecord | undefined> {
    const current = await this.findPaper(paperId);
    return current && this.rewriteRecord(withResolvedMetadata(current, metadata));
  }

  /**
   * Re-reads a paper's PDF through the import pipeline, for records imported offline or before the pipeline improved.
   * @returns the updated paper, or undefined when nothing better was found
   */
  async refreshMetadataFromPdf(paperId: string): Promise<PaperRecord | undefined> {
    const paper = await this.findPaper(paperId);
    if (!paper) { return undefined; }
    let bytes: Uint8Array;
    try {
      bytes = await this.ctx.fs.readFile(paperFiles(paper.path, this.ctx.paths.join).pdf);
    } catch {
      return undefined;
    }
    if (bytes.byteLength === 0) { return undefined; }
    const parsed = await this.parse(bytes, paper.citeKey);
    // A second guess is not better than the guess already stored.
    if (parsed.confidence === "low" || (!parsed.doi && parsed.confidence !== "high")) { return undefined; }
    return this.applyResolvedMetadata(paperId, parsed);
  }

  /** Rewrites a record's files, keeping the reading status, tags and note the files hold, then updates the index. */
  async rewriteRecord(record: PaperRecord): Promise<PaperRecord> {
    const written = await writePaperRecord(this.ctx, record, { ownsStatus: false });
    await this.reindex();
    return written;
  }

  /** @returns how many papers had their metadata.yaml and bib.bib rewritten */
  async regenerateBibTeX(): Promise<number> {
    const papers = await this.listPapers();
    for (const paper of papers) {
      await writePaperRecord(this.ctx, paper, { ownsStatus: false });
    }
    return papers.length;
  }

  /** Sends paper folders to the trash; a paper whose trash fails stays in the index. @returns what was trashed and the failures */
  async trashPapers(paperIds: string[]): Promise<BatchOutcome> {
    const { refs, unknown } = this.refsFor(paperIds);
    const outcome = await trashPapers(this.ctx, refs.map(({ paper }) => paper));
    if (outcome.done.length > 0) { await this.reindex(); }
    return { done: outcome.done, failed: [...unknown, ...outcome.failed] };
  }

  /** Moves paper folders into targetDir and re-points their records. @returns the moves made and the failures */
  async movePapers(paperIds: string[], targetDir: string): Promise<MoveOutcome> {
    const { refs, unknown } = this.refsFor(paperIds);
    const outcome = await movePapers(this.ctx, refs.map(({ paper }) => paper), targetDir);
    if (outcome.moves.length > 0) { await this.reindex(); }
    return { ...outcome, failed: [...unknown, ...outcome.failed] };
  }

  /**
   * Re-points the records of every paper under a folder that was renamed or moved. The ids and new paths come from
   * a fresh disk scan rather than from oldDir/newDir, since a diff-based reindex re-derives every nested path
   * change on its own.
   */
  async relocatePapersUnder(oldDir: string, newDir: string): Promise<void> {
    void oldDir;
    void newDir;
    await this.reindex();
  }

  /** Drops the records of every paper under a folder that was trashed; a fresh disk scan finds every id that is gone. */
  async removePapersUnder(dirPath: string): Promise<void> {
    void dirPath;
    await this.reindex();
  }

  // reconcilePdf's correction only ever changes hasPdf in memory; a reindex would undo the point of staying cheap.
  private announceUpdate(paper: PaperRecord): void {
    this.eventBus.emit(EVENTS.PAPER_UPDATED, paper);
  }

  // The file's copy of the user's fields wins, but an unchanged paper is not re-announced: sync and the AI index
  // react to every update. The indexed hasPdf stays, since the indexer and this disk read count symlinks differently.
  // Callers reindex once for their whole batch, not once per paper here.
  private resolveOwnedFields(current: PaperRecord, written: PaperRecord): { next: PaperRecord; changed: boolean } {
    const { hasPdf: _diskHasPdf, ...fields } = written;
    const next: PaperRecord = { ...fields, ...(current.hasPdf === undefined ? {} : { hasPdf: current.hasPdf }) };
    const same = next.status === current.status && (next.note ?? "") === (current.note ?? "")
      && (next.tags ?? []).join("\n") === (current.tags ?? []).join("\n");
    return { next, changed: !same };
  }

  private refsFor(paperIds: string[]): {
    refs: Array<{ paper: PaperRef; record: PaperRecord }>;
    unknown: Array<{ id: string; error: string }>;
  } {
    const refs: Array<{ paper: PaperRef; record: PaperRecord }> = [];
    const unknown: Array<{ id: string; error: string }> = [];
    for (const id of paperIds) {
      const record = this.store.snapshot.papers.get(id)?.record;
      if (record) { refs.push({ paper: { id, path: record.path }, record }); } else { unknown.push({ id, error: "Paper not found" }); }
    }
    return { refs, unknown };
  }
}
