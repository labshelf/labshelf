/** Applies the core library mutations to the IndexedDB library and keeps the paper-record cache in step with the files. */
import {
  BibtexService, createFolder, describePaperFileOnFileSystem, updatePaperTags, importShareLink, listPaperFiles, movePapers, posixPathOps, readPaperOnFileSystem, movePapersUnder, removePapersUnder, renameFolder, setPapersReadingStatus,
  moveFolderToTrash, movePapersToTrash, updatePaperFields, writeImportedPaper, writePaperRecord, PAPERS_DIR,
} from "@labshelf/core";
import type {
  BatchOutcome, FieldsBatchOutcome, ILogger, ImportedPaper, ImportShareLinkOptions, ImportShareLinkResult, IPaperRecordCache, MoveOutcome, MutationContext,
  PaperFilesState, PaperRecord, Reference, ReadingStatus, PdfVersion,
} from "@labshelf/core";
import { createLibraryFileSystem } from "./libraryFileSystem";
import { removeCachedPaperRecord, listCachedPaperRecords, writeCachedPaperRecord } from "./paperRecordStore";

export interface LibraryMutations {
  /** Writes a new paper folder under targetDir, with a cite key no cached paper or existing folder holds. */
  importPaper(targetDir: string, paper: ImportedPaper): Promise<PaperRecord>;
  /** Copies a share link's papers into a new folder under papers/, skipping the papers the library holds, and caches their records. */
  importShareLink(options: Pick<ImportShareLinkOptions, "text" | "readerFor" | "onProgress">): Promise<ImportShareLinkResult>;
  setStatus(papers: Reference[], status: ReadingStatus): Promise<FieldsBatchOutcome>;
  /** Adds and removes tags on several papers. */
  editTags(papers: Reference[], add: string[], remove: string[]): Promise<FieldsBatchOutcome>;
  /** Sets a paper's note; resolves to undefined when the paper's folder holds no paper. */
  setNote(paper: Reference, note: string): Promise<PaperRecord | undefined>;
  /** Records the day (YYYY-MM-DD) the authors were asked for a copy; undefined when the paper's folder holds no paper. */
  setPdfRequestedAt(paper: Reference, day: string): Promise<PaperRecord | undefined>;
  /**
   * Rewrites the metadata files of a paper whose PDF was just written, keeping the status on disk. The PDF's version is
   * set, or removed when unknown, and the text-layer check of any earlier file is dropped.
   */
  recordPdfAttached(record: PaperRecord, version?: PdfVersion): Promise<PaperRecord>;
  movePapers(papers: Reference[], targetDir: string): Promise<MoveOutcome>;
  trashPapers(papers: Reference[]): Promise<BatchOutcome>;
  createFolder(parentDir: string, name: string): Promise<string>;
  renameFolder(dir: string, name: string): Promise<string>;
  trashFolder(dir: string): Promise<void>;
  /** Lists the paper folder's entries with the descriptions its metadata.yaml holds; a failed read is a failed state. */
  listFiles(paper: Reference): Promise<PaperFilesState>;
  /** Sets or clears (empty) one entry's description; undefined when the paper's folder holds no paper. */
  describeFile(paper: Reference, name: string, description: string): Promise<PaperRecord | undefined>;
}

const recordIndex: IPaperRecordCache = {
  listPapers: () => listCachedPaperRecords(),
  upsertPaper: (paper) => writeCachedPaperRecord(paper, paper.path),
  deletePaper: (id) => removeCachedPaperRecord(id),
};

type FolderMutations = Pick<LibraryMutations, "createFolder" | "renameFolder" | "trashFolder">;
type FileMutations = Pick<LibraryMutations, "listFiles" | "describeFile">;

function fileMutations(ctx: MutationContext): FileMutations {
  return {
    // The descriptions come from disk, not the cache, so an edit that rewrote metadata.yaml shows at once.
    async listFiles(paper) {
      // A metadata.yaml that cannot be read still lets the files show, without descriptions.
      const onDisk = await readPaperOnFileSystem(ctx, paper.path).catch(async (error: unknown) => {
        await ctx.logger.error("paperFiles", error, { id: paper.id, paperDir: paper.path, action: "read descriptions" });
        return undefined;
      });
      return listPaperFiles(ctx.fs, paper.path, onDisk?.files, ctx.logger);
    },
    async describeFile(paper, name, description) {
      const record = await describePaperFileOnFileSystem(ctx, paper.path, name, description);
      if (record) { await writeCachedPaperRecord(record, record.path); }
      return record;
    },
  };
}

function folderMutations(ctx: MutationContext): FolderMutations {
  return {
    createFolder: (parentDir, name) => createFolder(ctx, parentDir, name),
    async renameFolder(dir, name) {
      const to = await renameFolder(ctx, dir, name);
      if (to !== dir) { await movePapersUnder(recordIndex, dir, to); }
      return to;
    },
    async trashFolder(dir) {
      await moveFolderToTrash(ctx, dir);
      await removePapersUnder(recordIndex, dir);
    },
  };
}

async function importShareLinkIntoCache(ctx: MutationContext, options: Pick<ImportShareLinkOptions, "text" | "readerFor" | "onProgress">): Promise<ImportShareLinkResult> {
  const result = await importShareLink({ ...options, ctx, parentDir: PAPERS_DIR, known: await listCachedPaperRecords() });
  if (result.status === "imported") {
    for (const record of result.summary.added) { await writeCachedPaperRecord(record, record.path); }
  }
  return result;
}

async function updateFieldsInCache(ctx: MutationContext, path: string, fields: Parameters<typeof updatePaperFields>[2]): Promise<PaperRecord | undefined> {
  const record = await updatePaperFields(ctx, path, fields);
  if (record) { await writeCachedPaperRecord(record, record.path); }
  return record;
}

/** The mutations run on disk first and the cache follows, so a failed write never leaves the cache ahead of the files. */
export function createLibraryMutations(logger: ILogger): LibraryMutations {
  const fs = createLibraryFileSystem();
  const ctx: MutationContext = { fs, paths: posixPathOps, artifacts: new BibtexService(fs), logger, papersRoot: PAPERS_DIR };

  return {
    async importPaper(targetDir, paper) {
      const record = await writeImportedPaper(ctx, (await listCachedPaperRecords()).map((r) => r.id), targetDir, paper);
      await writeCachedPaperRecord(record, record.path);
      return record;
    },
    importShareLink: (options) => importShareLinkIntoCache(ctx, options),
    async setStatus(papers, status) {
      const outcome = await setPapersReadingStatus(ctx, papers, status);
      for (const record of outcome.records) { await writeCachedPaperRecord(record, record.path); }
      return outcome;
    },
    async editTags(papers, add, remove) {
      const outcome = await updatePaperTags(ctx, papers, add, remove);
      for (const record of outcome.records) { await writeCachedPaperRecord(record, record.path); }
      return outcome;
    },
    setNote: (paper, note) => updateFieldsInCache(ctx, paper.path, { note }),
    setPdfRequestedAt: (paper, day) => updateFieldsInCache(ctx, paper.path, { pdfRequestedAt: day }),
    async recordPdfAttached(record, version) {
      const { textLayer: _stale, ...current } = (await readPaperOnFileSystem(ctx, record.path)) ?? record;
      const written = await writePaperRecord(ctx, { ...current, hasPdf: true, pdfVersion: version ?? null }, { ownsStatus: false });
      await writeCachedPaperRecord(written, written.path);
      return written;
    },
    async movePapers(papers, targetDir) {
      const outcome = await movePapers(ctx, papers, targetDir);
      for (const move of outcome.moves) { await movePapersUnder(recordIndex, move.from, move.to); }
      return outcome;
    },
    async trashPapers(papers) {
      const outcome = await movePapersToTrash(ctx, papers);
      for (const id of outcome.done) { await removeCachedPaperRecord(id); }
      return outcome;
    },
    ...folderMutations(ctx),
    ...fileMutations(ctx),
  };
}
