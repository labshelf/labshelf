/** Applies the core library mutations to the IndexedDB library and keeps the paper-record cache in step with the files. */
import {
  BibTeXService, createFolder, editPaperTags, movePapers, posixPathOps, readPaperOnDisk, relocatePapersUnder, removePapersUnder, renameFolder, setPaperStatus,
  trashFolder, trashPapers, updatePaperFields, writeImportedPaper, writePaperRecord, PAPERS_DIR,
} from "@labshelf/core";
import type {
  BatchOutcome, FieldsBatchOutcome, ILogger, ImportedPaper, IPaperRecordIndex, MoveOutcome, MutationContext, PaperRecord, PaperRef, PaperStatus, PdfVersion,
} from "@labshelf/core";
import { IndexedDbFileSystem } from "./indexedDbFileSystem";
import { deleteRecord, listAllRecords, upsertRecord } from "./paperRecordStore";

export interface LibraryMutations {
  /** Writes a new paper folder under targetDir, with a cite key no cached paper or existing folder holds. */
  importPaper(targetDir: string, paper: ImportedPaper): Promise<PaperRecord>;
  setStatus(papers: PaperRef[], status: PaperStatus): Promise<FieldsBatchOutcome>;
  /** Adds and removes tags on several papers. */
  editTags(papers: PaperRef[], add: string[], remove: string[]): Promise<FieldsBatchOutcome>;
  /** Sets a paper's note; resolves to undefined when the paper's folder holds no paper. */
  setNote(paper: PaperRef, note: string): Promise<PaperRecord | undefined>;
  /** Records the day (YYYY-MM-DD) the authors were asked for a copy; undefined when the paper's folder holds no paper. */
  setPdfRequestedAt(paper: PaperRef, day: string): Promise<PaperRecord | undefined>;
  /**
   * Rewrites the metadata files of a paper whose PDF was just written, keeping the status on disk. The PDF's version is
   * set, or removed when unknown, and the text-layer check of any earlier file is dropped.
   */
  recordPdfAttached(record: PaperRecord, version?: PdfVersion): Promise<PaperRecord>;
  movePapers(papers: PaperRef[], targetDir: string): Promise<MoveOutcome>;
  trashPapers(papers: PaperRef[]): Promise<BatchOutcome>;
  createFolder(parentDir: string, name: string): Promise<string>;
  renameFolder(dir: string, name: string): Promise<string>;
  trashFolder(dir: string): Promise<void>;
}

const recordIndex: IPaperRecordIndex = {
  listPapers: () => listAllRecords(),
  upsertPaper: (paper) => upsertRecord(paper, paper.path),
  deletePaper: (id) => deleteRecord(id),
};

type FolderMutations = Pick<LibraryMutations, "createFolder" | "renameFolder" | "trashFolder">;

function folderMutations(ctx: MutationContext): FolderMutations {
  return {
    createFolder: (parentDir, name) => createFolder(ctx, parentDir, name),
    async renameFolder(dir, name) {
      const to = await renameFolder(ctx, dir, name);
      if (to !== dir) { await relocatePapersUnder(recordIndex, dir, to); }
      return to;
    },
    async trashFolder(dir) {
      await trashFolder(ctx, dir);
      await removePapersUnder(recordIndex, dir);
    },
  };
}

/** The mutations run on disk first and the cache follows, so a failed write never leaves the cache ahead of the files. */
export function createLibraryMutations(logger: ILogger): LibraryMutations {
  const fs = new IndexedDbFileSystem();
  const ctx: MutationContext = { fs, paths: posixPathOps, artifacts: new BibTeXService(fs), logger, papersRoot: PAPERS_DIR };

  return {
    async importPaper(targetDir, paper) {
      const record = await writeImportedPaper(ctx, (await listAllRecords()).map((r) => r.id), targetDir, paper);
      await upsertRecord(record, record.path);
      return record;
    },
    async setStatus(papers, status) {
      const outcome = await setPaperStatus(ctx, papers, status);
      for (const record of outcome.records) { await upsertRecord(record, record.path); }
      return outcome;
    },
    async editTags(papers, add, remove) {
      const outcome = await editPaperTags(ctx, papers, add, remove);
      for (const record of outcome.records) { await upsertRecord(record, record.path); }
      return outcome;
    },
    async setNote(paper, note) {
      const record = await updatePaperFields(ctx, paper.path, { note });
      if (record) { await upsertRecord(record, record.path); }
      return record;
    },
    async setPdfRequestedAt(paper, day) {
      const record = await updatePaperFields(ctx, paper.path, { pdfRequestedAt: day });
      if (record) { await upsertRecord(record, record.path); }
      return record;
    },
    async recordPdfAttached(record, version) {
      const { textLayer: _stale, ...current } = (await readPaperOnDisk(ctx, record.path)) ?? record;
      const written = await writePaperRecord(ctx, { ...current, hasPdf: true, pdfVersion: version ?? null }, { ownsStatus: false });
      await upsertRecord(written, written.path);
      return written;
    },
    async movePapers(papers, targetDir) {
      const outcome = await movePapers(ctx, papers, targetDir);
      for (const move of outcome.moves) { await relocatePapersUnder(recordIndex, move.from, move.to); }
      return outcome;
    },
    async trashPapers(papers) {
      const outcome = await trashPapers(ctx, papers);
      for (const id of outcome.done) { await deleteRecord(id); }
      return outcome;
    },
    ...folderMutations(ctx),
  };
}
