// Tests the paper data store for annotations and reading state.
import { PaperDataStore } from '../../../src/reader/sidecar/paperDataStore';
import { emptyPaperData } from '../../../src/reader/sidecar/paperData';
import type { SidecarPort } from '../../../src/ports/index';

function memoryPort(seed: Record<string, string> = {}): SidecarPort & { files: Record<string, string>; writes: number } {
  const port = {
    files: { ...seed },
    writes: 0,
    async read(id: string) { return port.files[id] ?? null; },
    async write(id: string, text: string) { port.writes++; port.files[id] = text; },
  };
  return port;
}

let seq = 0;
const store = (port: SidecarPort) => new PaperDataStore(port, { now: () => '2026-10-07T12:00:00.000Z', newId: () => `id-${++seq}` });

describe('PaperDataStore', () => {
  it('returns empty data when the sidecar is absent or corrupt', async () => {
    expect(await store(memoryPort()).load('p')).toEqual(emptyPaperData());
    expect(await store(memoryPort({ p: '{not json' })).load('p')).toEqual(emptyPaperData());
  });

  it('adds highlights and notes, and lists them by page then creation time', async () => {
    const port = memoryPort();
    const s = store(port);
    await s.addHighlight('p', 3, 'later page', 'blue');
    const h = await s.addHighlight('p', 1, 'first', 'yellow', { x: 0, y: 0, width: 0.5, height: 0.1 });
    await s.addNote('p', 2, 'a note');
    expect(h).toMatchObject({ type: 'highlight', color: 'yellow', paperId: 'p', createdAt: '2026-10-07T12:00:00.000Z' });
    expect((await s.getAnnotations('p')).map((a) => a.pageNumber)).toEqual([1, 2, 3]);
    const note = (await s.getAnnotations('p')).find((a) => a.type === 'note')!;
    expect(note).not.toHaveProperty('color');
    expect(note).not.toHaveProperty('position');
  });

  it('rejects invalid colors, pages and empty content without writing', async () => {
    const port = memoryPort();
    const s = store(port);
    await expect(s.addHighlight('p', 1, 'x', 'purple')).rejects.toThrow('Invalid annotation color');
    await expect(s.addHighlight('p', 0, 'x', 'red')).rejects.toThrow('Invalid page number');
    await expect(s.addHighlight('p', 1, '  ', 'red')).rejects.toThrow('cannot be empty');
    await expect(s.addNote('p', 1, '')).rejects.toThrow('cannot be empty');
    expect(port.writes).toBe(0);
  });

  it('updates and deletes annotations; unknown ids fail or no-op without a write', async () => {
    const port = memoryPort();
    const s = store(port);
    const a = await s.addNote('p', 1, 'old');
    expect((await s.updateAnnotation('p', a.id, 'new')).content).toBe('new');
    await expect(s.updateAnnotation('p', 'missing', 'x')).rejects.toThrow('not found');
    const before = port.writes;
    expect(await s.deleteAnnotation('p', 'missing')).toBe(false);
    expect(port.writes).toBe(before);
    expect(await s.deleteAnnotation('p', a.id)).toBe(true);
    expect(await s.getAnnotations('p')).toEqual([]);
  });

  it('serializes concurrent writes so none is lost', async () => {
    const port = memoryPort();
    const s = store(port);
    await Promise.all([
      s.setTheme('p', 'sepia'),
      s.setReadingState('p', { page: 4, scaleValue: 'page-fit', updatedAt: 't' }),
      s.addNote('p', 1, 'n1'),
      s.addNote('p', 2, 'n2'),
    ]);
    const data = await s.load('p');
    expect(data.theme).toBe('sepia');
    expect(data.reading?.page).toBe(4);
    expect(data.annotations).toHaveLength(2);
    expect(await s.getTheme('p')).toBe('sepia');
    expect((await s.getReadingState('p'))?.scaleValue).toBe('page-fit');
  });

  it('keeps going after a failed write', async () => {
    const port = memoryPort();
    let fail = true;
    const flaky: SidecarPort = { read: port.read, write: async (id, t) => { if (fail) { fail = false; throw new Error('disk'); } await port.write(id, t); } };
    const s = store(flaky);
    await expect(s.setTheme('p', 'dark')).rejects.toThrow('disk');
    await s.setTheme('p', 'light');
    expect(await s.getTheme('p')).toBe('light');
  });
});

describe('PaperDataStore theme and reading state', () => {
  const reading = { page: 7, scaleValue: 'page-width', left: 0, top: 412.5, updatedAt: '2026-02-03T10:00:00.000Z' };

  it('defaults the theme to auto and round-trips a chosen one', async () => {
    const s = store(memoryPort());
    expect(await s.getTheme('p')).toBe('auto');
    await s.setTheme('p', 'sepia');
    expect(await s.getTheme('p')).toBe('sepia');
  });

  it('keeps theme, annotations and reading state independent', async () => {
    const s = store(memoryPort());
    await s.addNote('p', 1, 'a');
    await s.setTheme('p', 'sepia');
    const withSidebar = { ...reading, sidebar: { open: true, tab: 'outline' as const, width: 260 } };
    await s.setReadingState('p', withSidebar);
    const data = await s.load('p');
    expect(data.annotations).toHaveLength(1);
    expect(data.theme).toBe('sepia');
    expect(data.reading).toEqual(withSidebar);
  });

  it('reads no reading state until the paper has been read, and writes no reading key', async () => {
    const port = memoryPort();
    const s = store(port);
    expect(await s.getReadingState('p')).toBeNull();
    await s.setTheme('p', 'dark');
    expect(JSON.parse(port.files['p']!)).toEqual({ annotations: [], theme: 'dark' });
  });

  it('loads a sidecar that has no reading key', async () => {
    const s = store(memoryPort({ p: JSON.stringify({ annotations: [], theme: 'dark' }) }));
    expect(await s.load('p')).toEqual({ annotations: [], theme: 'dark' });
  });

  it('drops a corrupt reading value instead of failing the load', async () => {
    const s = store(memoryPort({ p: JSON.stringify({ annotations: [], theme: 'sepia', reading: { page: 'seven', scaleValue: 12 } }) }));
    const data = await s.load('p');
    expect(data.theme).toBe('sepia');
    expect(data.reading).toBeUndefined();
  });

  it('does not serialise different papers behind each other', async () => {
    const port = memoryPort();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: SidecarPort = { read: port.read, write: async (id, t) => { if (id === 'slow') { await gate; } await port.write(id, t); } };
    const s = store(slow);
    const blocked = s.setTheme('slow', 'dark');
    await s.setTheme('fast', 'sepia');
    expect(await s.getTheme('fast')).toBe('sepia');
    expect(port.files['slow']).toBeUndefined();
    release();
    await blocked;
    expect(await s.getTheme('slow')).toBe('dark');
  });
});

describe('PaperDataStore annotations', () => {
  it('accepts all five colours', async () => {
    const s = store(memoryPort());
    for (const color of ['yellow', 'green', 'blue', 'red', 'pink']) {
      expect((await s.addHighlight('p', 1, 'x', color)).color).toBe(color);
    }
  });

  it('stores a highlight without a position', async () => {
    const s = store(memoryPort());
    const h = await s.addHighlight('p', 1, 'x', 'yellow');
    expect(h).not.toHaveProperty('position');
    expect((await s.getAnnotations('p'))[0]).toEqual(h);
  });

  it('stores a note with its text and page', async () => {
    const s = store(memoryPort());
    const note = await s.addNote('p', 4, 'remember');
    expect(note).toMatchObject({ type: 'note', pageNumber: 4, content: 'remember', paperId: 'p' });
  });

  it('keeps annotations of different papers apart', async () => {
    const s = store(memoryPort());
    await s.addNote('a', 1, 'in a');
    await s.addNote('b', 1, 'in b');
    expect((await s.getAnnotations('a')).map((x) => x.content)).toEqual(['in a']);
    expect((await s.getAnnotations('b')).map((x) => x.content)).toEqual(['in b']);
  });

  it('writes annotation keys in the contract order', async () => {
    const port = memoryPort();
    const s = store(port);
    await s.addHighlight('p', 2, 'text', 'green', { x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
    await s.addNote('p', 1, 'note');
    const [highlight, note] = (JSON.parse(port.files['p']!) as { annotations: object[] }).annotations;
    expect(Object.keys(highlight!)).toEqual(['id', 'paperId', 'type', 'pageNumber', 'content', 'color', 'position', 'createdAt', 'updatedAt']);
    expect(Object.keys(note!)).toEqual(['id', 'paperId', 'type', 'pageNumber', 'content', 'createdAt', 'updatedAt']);
    expect(port.files['p']).toContain('"id": "id-');
    expect(port.files['p']!.indexOf('"id"')).toBeLessThan(port.files['p']!.indexOf('"paperId"'));
  });
});

describe('PaperDataStore logging', () => {
  it('logs a warning when the sidecar does not parse, and still loads empty data', async () => {
    const log = jest.fn(async () => undefined);
    const logger = { log, error: jest.fn(async () => undefined) };
    const s = new PaperDataStore(memoryPort({ p: '{not json' }), { logger });
    expect(await s.load('p')).toEqual(emptyPaperData());
    expect(log).toHaveBeenCalledWith('WARN', 'sidecar', expect.any(String), expect.objectContaining({ paperId: 'p' }));
  });

  it('does not log for a missing sidecar', async () => {
    const log = jest.fn(async () => undefined);
    await new PaperDataStore(memoryPort(), { logger: { log, error: jest.fn(async () => undefined) } }).load('p');
    expect(log).not.toHaveBeenCalled();
  });
});
