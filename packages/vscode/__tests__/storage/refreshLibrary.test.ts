/**
 * Unit tests for reindexLibrary: the store follows the scan, and the right paper events and text-layer checks
 * follow the diff, without touching an unchanged library.
 */
import { LibraryStore } from '@labshelf/core';
import type { LibraryScan, PaperRecord } from '@labshelf/core';
import { createLibraryEvents } from '../../src/library/index';
import { refreshLibrary } from '../../src/storage/refreshLibrary';

const rec = (over: Partial<PaperRecord>): PaperRecord => ({
  id: 'p', title: 'P', path: '/lib/papers/p', citeKey: 'p', status: 'unread', ...over,
});

const scanOf = (records: PaperRecord[]): (() => Promise<LibraryScan>) => async () => ({
  papers: records.map((record) => ({ record, collection: '', modifiedMs: 0 })),
  folders: [], orphans: [], duplicates: [],
});

// A store whose scan reads from a mutable array, so a test can change what the "next" reload finds.
async function freshStore(seed: PaperRecord[] = []): Promise<{ store: LibraryStore; setNext: (records: PaperRecord[]) => void }> {
  let records = seed;
  const store = new LibraryStore({ root: '/lib/papers', scan: () => scanOf(records)() });
  await store.reload();
  return { store, setNext: (next) => { records = next; } };
}

function run(store: LibraryStore, setNext: (records: PaperRecord[]) => void, next: PaperRecord[]) {
  setNext(next);
  const events = createLibraryEvents();
  const emit = jest.fn();
  events.paperAdded.event((paper) => emit('paper:added', paper));
  events.paperUpdated.event((paper) => emit('paper:updated', paper));
  events.paperDeleted.event((paper) => emit('paper:deleted', paper));
  const queueCheck = jest.fn();
  const summary = refreshLibrary({ store, events, queueCheck });
  return { summary, emit, queueCheck };
}

describe('refreshLibrary', () => {
  it('emits paper:updated and queues a check when a PDF appears', async () => {
    const { store, setNext } = await freshStore([rec({ id: 'a', hasPdf: false })]);
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'a', hasPdf: true })]);

    expect(await summary).toEqual({ added: [], updated: ['a'], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', hasPdf: true }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['a']);
  });

  it('emits paper:added for a new folder, stores it and queues its check', async () => {
    const { store, setNext } = await freshStore();
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'new', hasPdf: true })]);

    expect(await summary).toEqual({ added: ['new'], updated: [], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:added', expect.objectContaining({ id: 'new' }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['new']);
    expect([...store.snapshot.papers.keys()]).toEqual(['new']);
  });

  it('deletes a paper missing from the scan and emits paper:deleted', async () => {
    const { store, setNext } = await freshStore([rec({ id: 'gone' }), rec({ id: 'kept', path: '/lib/papers/kept' })]);
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'kept', path: '/lib/papers/kept' })]);

    expect(await summary).toEqual({ added: [], updated: [], removed: ['gone'] });
    expect(emit).toHaveBeenCalledWith('paper:deleted', { id: 'gone' });
    expect([...store.snapshot.papers.keys()]).toEqual(['kept']);
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does nothing, with no events and no check, for an unchanged library', async () => {
    const seed = [rec({ id: 'a', hasPdf: true, textLayer: { state: 'native', checkedAt: 'x' } })];
    const { store, setNext } = await freshStore(seed);
    const { summary, emit, queueCheck } = run(store, setNext, seed);

    expect(await summary).toEqual({ added: [], updated: [], removed: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does not re-check an updated paper that already had its PDF', async () => {
    const { store, setNext } = await freshStore([rec({ id: 'a', hasPdf: true, title: 'Old' })]);
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'a', hasPdf: true, title: 'New' })]);

    expect(await summary).toEqual({ added: [], updated: ['a'], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', title: 'New' }));
    expect(queueCheck).not.toHaveBeenCalled();
  });
});
