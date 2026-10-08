/**
 * Unit tests for reindexLibrary: the cache follows the scan, and the right paper events and text-layer checks
 * follow the cache, without touching an unchanged library.
 */
import { InMemoryResearchDatabase } from '@labshelf/core';
import type { LibraryScan, PaperRecord } from '@labshelf/core';
import { indexLibrary, reindexLibrary } from '../../src/storage/data/reindexLibrary';

const rec = (over: Partial<PaperRecord>): PaperRecord => ({
  id: 'p', title: 'P', path: '/lib/papers/p', citeKey: 'p', status: 'unread', ...over,
});

const scanOf = (records: PaperRecord[]) => async (): Promise<LibraryScan> => ({
  papers: records.map((record) => ({ record, collection: '', modifiedMs: 0 })),
  folders: [], orphans: [], duplicates: [],
});

async function freshDb(seed: PaperRecord[] = []): Promise<InMemoryResearchDatabase> {
  const db = new InMemoryResearchDatabase();
  await db.initialize();
  for (const p of seed) { await db.upsertPaper(p); }
  return db;
}

function run(db: InMemoryResearchDatabase, next: PaperRecord[]) {
  const emit = jest.fn();
  const queueCheck = jest.fn();
  const summary = reindexLibrary({ database: db, scan: scanOf(next), eventBus: { emit } as never, queueCheck });
  return { summary, emit, queueCheck };
}

describe('reindexLibrary', () => {
  it('emits paper:updated and queues a check when a PDF appears', async () => {
    const db = await freshDb([rec({ id: 'a', hasPdf: false })]);
    const { summary, emit, queueCheck } = run(db, [rec({ id: 'a', hasPdf: true })]);

    expect(await summary).toEqual({ added: [], updated: ['a'], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', hasPdf: true }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['a']);
  });

  it('emits paper:added for a new folder, stores it and queues its check', async () => {
    const db = await freshDb();
    const { summary, emit, queueCheck } = run(db, [rec({ id: 'new', hasPdf: true })]);

    expect(await summary).toEqual({ added: ['new'], updated: [], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:added', expect.objectContaining({ id: 'new' }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['new']);
    expect((await db.listPapers()).map((p) => p.id)).toEqual(['new']);
  });

  it('deletes a paper missing from the scan and emits paper:deleted', async () => {
    const db = await freshDb([rec({ id: 'gone' }), rec({ id: 'kept', path: '/lib/papers/kept' })]);
    const { summary, emit, queueCheck } = run(db, [rec({ id: 'kept', path: '/lib/papers/kept' })]);

    expect(await summary).toEqual({ added: [], updated: [], removed: ['gone'] });
    expect(emit).toHaveBeenCalledWith('paper:deleted', { id: 'gone' });
    expect((await db.listPapers()).map((p) => p.id)).toEqual(['kept']);
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does nothing, with no events and no check, for an unchanged library', async () => {
    const db = await freshDb([rec({ id: 'a', hasPdf: true, textLayer: { state: 'native', checkedAt: 'x' } })]);
    const { summary, emit, queueCheck } = run(db, [rec({ id: 'a', hasPdf: true, textLayer: { state: 'native', checkedAt: 'x' } })]);

    expect(await summary).toEqual({ added: [], updated: [], removed: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does not re-check an updated paper that already had its PDF', async () => {
    const db = await freshDb([rec({ id: 'a', hasPdf: true, title: 'Old' })]);
    const { summary, emit, queueCheck } = run(db, [rec({ id: 'a', hasPdf: true, title: 'New' })]);

    expect(await summary).toEqual({ added: [], updated: ['a'], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', title: 'New' }));
    expect(queueCheck).not.toHaveBeenCalled();
  });
});

describe('indexLibrary', () => {
  it('updates the cache without announcing anything', async () => {
    const db = await freshDb([rec({ id: 'old' })]);
    const diff = await indexLibrary({ database: db, scan: scanOf([rec({ id: 'new' })]) });
    expect(diff.added.map((p) => p.id)).toEqual(['new']);
    expect(diff.removed.map((p) => p.id)).toEqual(['old']);
    expect((await db.listPapers()).map((p) => p.id)).toEqual(['new']);
  });
});
