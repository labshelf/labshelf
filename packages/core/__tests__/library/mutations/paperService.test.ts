import * as path from "node:path";

import { BibtexService, LibraryStore, PaperFileService, PaperService, comparePapers, scanLibrary } from "@labshelf/core";
import type { MutationContext, PaperRecord } from "@labshelf/core";
import { stringify } from "yaml";

import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { pdfBytes } from "../../support/mutationHarness";

const PAPERS_ROOT = "/lib/papers";

/** The paper service over the real core mutations: an in-memory disk, a LibraryStore scanning it, and an event spy. */
async function makeGlue() {
  const fs = new MemoryLibraryFs();
  const emitted: Array<[string, unknown]> = [];
  const logger = fakeLogger();
  const logSpy = { log: jest.fn(logger.log), error: jest.fn(logger.error) };
  const ctx: MutationContext = { fs, paths: path, artifacts: new BibtexService(fs), logger: logSpy, papersRoot: PAPERS_ROOT, now: () => "2026-01-01T00:00:00.000Z" };
  const store = new LibraryStore({ root: PAPERS_ROOT, scan: () => scanLibrary(fs, path, PAPERS_ROOT, logSpy) });
  const papersOf = (): PaperRecord[] => [...store.snapshot.papers.values()].map((entry) => entry.record);
  let reindexCalls = 0;
  const reindex = async () => {
    reindexCalls += 1;
    const before = papersOf();
    await store.reload();
    const diff = comparePapers(before, papersOf());
    for (const paper of diff.added) { emitted.push(["paper:added", paper]); }
    for (const paper of diff.updated) { emitted.push(["paper:updated", paper]); }
    for (const paper of diff.removed) { emitted.push(["paper:deleted", { id: paper.id }]); }
  };
  const events = { paperUpdated: { fire: (paper: PaperRecord) => { emitted.push(["paper:updated", paper]); } } };
  const parse = jest.fn(async () => ({ title: "Test Paper", citeKey: "testpaper2024", authors: ["Alice"], year: 2024 }));
  const pdfPresent = async (pdfPath: string) => (await fs.stat(pdfPath))?.isFile === true;
  const service = new PaperService(ctx, store, reindex, events, parse, pdfPresent);
  await fs.mkdir(PAPERS_ROOT);
  return {
    fs, ctx, emitted, service, reindex,
    get rows() { return papersOf(); },
    reindexCalls: () => reindexCalls,
    /** Writes a paper to disk (hasPdf: false skips paper.pdf), then reloads the store so it is indexed. */
    async seed(id: string, meta: Record<string, unknown> & { hasPdf?: boolean } = {}, dir = PAPERS_ROOT): Promise<PaperRecord> {
      const { hasPdf = true, ...rest } = meta;
      await fs.writeText(`${dir}/${id}/metadata.yaml`, stringify({ title: `Title ${id}`, status: "unread", ...rest }));
      if (hasPdf) { await fs.writeFile(`${dir}/${id}/paper.pdf`, pdfBytes()); }
      await store.reload();
      const found = store.paper(id);
      if (!found) { throw new Error(`seed(${id}) did not appear in the store after reload`); }
      return found.record;
    },
  };
}
type Glue = Awaited<ReturnType<typeof makeGlue>>;

describe('PaperService field edits', () => {
  it('writes metadata.yaml first, then updates the index and announces the paper', async () => {
    const g = await makeGlue();
    await g.seed('p1');

    const updated = await g.service.updatePaperFields('p1', { status: 'done', tags: ['read-twice'] });

    expect(updated).toMatchObject({ status: 'done', tags: ['read-twice'] });
    expect(await g.fs.readText(`${PAPERS_ROOT}/p1/metadata.yaml`)).toMatch(/status: done/);
    expect(g.rows[0]).toMatchObject({ status: 'done', tags: ['read-twice'] });
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ id: 'p1', status: 'done' })]]);
  });

  it('leaves the index and events alone when the disk write fails', async () => {
    const g = await makeGlue();
    await g.seed('p1');
    g.fs.failWrites = new Error('EACCES');

    await expect(g.service.updatePaperFields('p1', { status: 'done' })).rejects.toThrow('EACCES');

    expect(g.reindexCalls()).toBe(0);
    expect(g.rows[0]!.status).toBe('unread');
    expect(g.emitted).toEqual([]);
  });

  it('does not re-announce a patch that changes nothing', async () => {
    const g = await makeGlue();
    await g.seed('p1');
    await g.service.updatePapersStatus(['p1'], 'unread');
    expect(g.emitted).toEqual([]);
  });

  it('sets one status on several papers with a single reindex and reports unknown ids', async () => {
    const g = await makeGlue();
    await g.seed('p1');
    await g.seed('p2');
    await g.seed('p3');

    const failed = await g.service.updatePapersStatus(['p1', 'p2', 'ghost'], 'done');

    expect(failed).toEqual(['ghost']);
    expect(g.reindexCalls()).toBe(1);
    expect(g.rows.map((row) => row.status)).toEqual(['done', 'done', 'unread']);
    expect(g.emitted.map(([name]) => name)).toEqual(['paper:updated', 'paper:updated']);
  });

  it('edits tags on several papers and reports unknown ids', async () => {
    const g = await makeGlue();
    await g.seed('p1', { tags: ['old', 'keep'] });
    await g.seed('p2');

    const outcome = await g.service.editTags(['p1', 'p2', 'ghost'], ['new'], ['old']);

    expect(outcome.done).toEqual(['p1', 'p2']);
    expect(outcome.failed).toEqual([{ id: 'ghost', error: 'Paper not found' }]);
    expect(g.rows.map((row) => row.tags)).toEqual([['keep', 'new'], ['new']]);
  });
});

describe('PaperService.trashPapers', () => {
  it('drops the row and announces it only once the folder is in the trash', async () => {
    const g = await makeGlue();
    await g.seed('p1');

    expect(await g.service.trashPapers(['p1'])).toEqual({ done: ['p1'], failed: [] });
    expect(await g.fs.exists(`${PAPERS_ROOT}/p1`)).toBe(false);
    expect(g.rows).toEqual([]);
    expect(g.emitted).toEqual([['paper:deleted', { id: 'p1' }]]);
  });

  it('keeps a paper whose trash fails in the index and reports why', async () => {
    const g = await makeGlue();
    await g.seed('p1');
    g.fs.trashFails.add(`${PAPERS_ROOT}/p1`);

    const outcome = await g.service.trashPapers(['p1']);

    expect(outcome.done).toEqual([]);
    expect(outcome.failed).toEqual([{ id: 'p1', error: `Cannot move ${PAPERS_ROOT}/p1 to the trash` }]);
    expect(g.rows.map((row) => row.id)).toEqual(['p1']);
    expect(g.emitted).toEqual([]);
  });
});

describe('PaperService.movePapers', () => {
  it('moves the folder on disk, then re-points the record', async () => {
    const g = await makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/A`);
    await g.fs.mkdir(`${PAPERS_ROOT}/B`);

    const outcome = await g.service.movePapers(['p1', 'ghost'], `${PAPERS_ROOT}/B`);

    expect(outcome.done).toEqual(['p1']);
    expect(outcome.failed).toEqual([{ id: 'ghost', error: 'Paper not found' }]);
    expect(await g.fs.exists(`${PAPERS_ROOT}/B/p1/metadata.yaml`)).toBe(true);
    expect(g.rows[0]!.path).toBe(`${PAPERS_ROOT}/B/p1`);
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ path: `${PAPERS_ROOT}/B/p1` })]]);
  });

  it('reports a name clash in the shared wording and leaves the record where it is', async () => {
    const g = await makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/A`);
    await g.fs.mkdir(`${PAPERS_ROOT}/B/p1`);

    const outcome = await g.service.movePapers(['p1'], `${PAPERS_ROOT}/B`);

    expect(outcome.failed).toEqual([{ id: 'p1', error: '"p1" already exists there' }]);
    expect(g.rows[0]!.path).toBe(`${PAPERS_ROOT}/A/p1`);
  });
});

describe('PaperService metadata rewrites', () => {
  it('applies resolved metadata, keeping the status the file holds', async () => {
    const g = await makeGlue();
    await g.seed('p1');
    await g.fs.writeText(`${PAPERS_ROOT}/p1/metadata.yaml`, 'title: "Title p1"\nstatus: reading\n');

    const updated = await g.service.applyResolvedMetadata('p1', { title: 'Resolved', doi: '10.1/x' });

    expect(updated).toMatchObject({ title: 'Resolved', doi: '10.1/x', status: 'reading' });
    expect(g.rows[0]).toMatchObject({ title: 'Resolved', status: 'reading' });
  });
});

describe('PaperService PDF lookups', () => {
  it('resolves the PDF from the stored path, and null for an unknown id or a paper without one', async () => {
    const g = await makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/Project`);
    await g.seed('p2', { hasPdf: false });
    expect(await g.service.resolvePdfPath('p1')).toBe(`${PAPERS_ROOT}/Project/p1/paper.pdf`);
    expect(await g.service.resolvePdfPath('p2')).toBeNull();
    expect(await g.service.resolvePdfPath('ghost')).toBeNull();
  });

  it('reconcilePdf corrects a stale flag in the index only', async () => {
    const g = await makeGlue();
    await g.seed('p1', { hasPdf: false });
    await g.fs.writeFile(`${PAPERS_ROOT}/p1/paper.pdf`, pdfBytes());
    expect(await g.service.reconcilePdf('p1')).toEqual({ paper: expect.objectContaining({ hasPdf: true }), hasPdf: true });
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ hasPdf: true })]]);
  });
});

const DIR = `${PAPERS_ROOT}/p1`;

async function setup(meta: Record<string, unknown> = {}) {
  const g: Glue = await makeGlue();
  await g.seed('p1', meta);
  await g.fs.writeText(`${DIR}/data.csv`, 'a,b');
  await g.fs.mkdir(`${DIR}/figures`);
  const logger = g.ctx.logger;
  const reindex = jest.fn(g.reindex);
  const service = new PaperFileService(g.fs, (id) => g.service.findPaper(id), g.ctx, logger, reindex);
  return { g, service, logger, reindex };
}

const names = (state: unknown): string[] => (state as { files: Array<{ name: string }> }).files.map((f) => f.name);

describe('PaperFileService.list', () => {
  it('lists paper.pdf first, then files, then folders, hiding metadata.yaml', async () => {
    const { service } = await setup();
    const state = await service.list('p1');
    expect(state.status).toBe('ready');
    expect(names(state)).toEqual(['paper.pdf', 'data.csv', 'figures']);
  });

  it('joins the descriptions stored in metadata.yaml', async () => {
    const { service } = await setup({ files: { 'data.csv': 'raw runs' } });
    const state = await service.list('p1');
    expect((state as { files: Array<{ name: string; description?: string }> }).files.find((f) => f.name === 'data.csv')?.description).toBe('raw runs');
  });

  it('returns a failed state for an unknown paper', async () => {
    const { service } = await setup();
    expect((await service.list('nope')).status).toBe('failed');
  });

  it('returns a failed state and logs the id and path when the folder cannot be read', async () => {
    const { g, service, logger } = await setup();
    jest.spyOn(g.fs, 'listDir').mockRejectedValueOnce(new Error('EACCES'));
    const state = await service.list('p1');
    expect(state).toEqual({ status: 'failed', message: 'EACCES' });
    expect(JSON.stringify([(logger.log as jest.Mock).mock.calls, (logger.error as jest.Mock).mock.calls])).toContain(DIR);
  });
});

describe('PaperFileService.describe', () => {
  it('writes the description to metadata.yaml, reindexes and returns the fresh listing', async () => {
    const { g, service, reindex } = await setup();
    const state = await service.describe('p1', 'data.csv', '  raw runs ');
    expect(await g.fs.readText(`${DIR}/metadata.yaml`)).toContain('raw runs');
    expect(reindex).toHaveBeenCalledTimes(1);
    expect((state as { files: Array<{ name: string; description?: string }> }).files.find((f) => f.name === 'data.csv')?.description).toBe('raw runs');
  });

  it('keeps the status the paper already has', async () => {
    const { g, service } = await setup({ status: 'done' });
    await service.describe('p1', 'data.csv', 'x');
    expect(await g.fs.readText(`${DIR}/metadata.yaml`)).toMatch(/status: "?done/);
  });

  it('removes the entry when the description is empty', async () => {
    const { g, service } = await setup({ files: { 'data.csv': 'raw runs' } });
    const state = await service.describe('p1', 'data.csv', '');
    expect(await g.fs.readText(`${DIR}/metadata.yaml`)).not.toContain('raw runs');
    expect((state as { files: Array<{ description?: string }> }).files.some((f) => f.description)).toBe(false);
  });

  it('refuses a name not on disk: undefined, a WARN log, metadata untouched', async () => {
    const { g, service, logger, reindex } = await setup();
    const before = await g.fs.readText(`${DIR}/metadata.yaml`);
    expect(await service.describe('p1', 'gone.txt', 'x')).toBeUndefined();
    expect(logger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.any(String), expect.objectContaining({ id: 'p1', name: 'gone.txt' }));
    expect(await g.fs.readText(`${DIR}/metadata.yaml`)).toBe(before);
    expect(reindex).not.toHaveBeenCalled();
  });

  it('refuses an unknown paper', async () => {
    const { service } = await setup();
    expect(await service.describe('nope', 'data.csv', 'x')).toBeUndefined();
  });
});
