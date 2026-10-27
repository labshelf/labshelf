import {
  createEmptyPaperSidecar,
  normalizePaperSidecar,
  serializePaperSidecar,
  PaperSidecarStore,
  checkAnnotationPosition,
  createPreviewStore,
  PREVIEW_ANNOTATION_REFUSAL,
} from "../../../src/reader/sidecar/sidecarStore";
import type { SidecarPort } from "../../../src/ports/index";

describe('normalizePaperSidecar', () => {
  it('returns empty data for anything that is not an object', () => {
    expect(normalizePaperSidecar(null)).toEqual(createEmptyPaperSidecar());
    expect(normalizePaperSidecar([])).toEqual(createEmptyPaperSidecar());
    expect(normalizePaperSidecar('x')).toEqual(createEmptyPaperSidecar());
  });

  it('drops malformed annotations, unknown themes and an unusable reading state', () => {
    const data = normalizePaperSidecar({ annotations: [{ id: 'a' }, { nope: 1 }, null], theme: 'neon', reading: { page: 0 } });
    expect(data.annotations).toEqual([{ id: 'a' }]);
    expect(data.theme).toBe('auto');
    expect(data.reading).toBeUndefined();
  });

  it('keeps a valid reading state', () => {
    const data = normalizePaperSidecar({ annotations: [], theme: 'sepia', reading: { page: 3, scaleValue: 'page-width', updatedAt: 't' } });
    expect(data.theme).toBe('sepia');
    expect(data.reading).toEqual({ page: 3, scaleValue: 'page-width', updatedAt: 't' });
  });
});

describe('serializePaperSidecar', () => {
  it('writes the VS Code sidecar format: fixed key order, two-space indent, reading only when set', () => {
    expect(serializePaperSidecar({ annotations: [], theme: 'auto' })).toBe('{\n  "annotations": [],\n  "theme": "auto"\n}');
    const withReading = serializePaperSidecar({ reading: { page: 2, scaleValue: '1.5', updatedAt: 't' }, theme: 'dark', annotations: [] });
    expect(Object.keys(JSON.parse(withReading))).toEqual(['annotations', 'theme', 'reading']);
  });

  it('writes deletion markers after reading and omits them when empty', () => {
    const marker = { id: 'a', deletedAt: '2026-10-01T00:00:00.000Z' };
    const withDeleted = serializePaperSidecar({ annotations: [], theme: 'dark', deleted: [marker], reading: { page: 2, scaleValue: '1.5', updatedAt: 't' } });
    expect(Object.keys(JSON.parse(withDeleted))).toEqual(['annotations', 'theme', 'reading', 'deleted']);
    expect(serializePaperSidecar({ annotations: [], theme: 'auto', deleted: [] })).toBe('{\n  "annotations": [],\n  "theme": "auto"\n}');
  });

  it('writes deletion markers sorted by id', () => {
    const deleted = [{ id: 'b', deletedAt: '2026-10-02T00:00:00.000Z' }, { id: 'a', deletedAt: '2026-10-01T00:00:00.000Z' }];
    const written = JSON.parse(serializePaperSidecar({ annotations: [], theme: 'auto', deleted })) as { deleted: { id: string }[] };
    expect(written.deleted.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('drops invalid deletion markers on read', () => {
    const marker = { id: 'a', deletedAt: '2026-10-01T00:00:00.000Z' };
    expect(normalizePaperSidecar({ annotations: [], theme: 'auto', deleted: [marker, { id: 1 }, null, { id: 'b' }, { id: 'c', deletedAt: 'zzz' }] }).deleted).toEqual([marker]);
    expect(normalizePaperSidecar({ annotations: [], theme: 'auto' }).deleted).toBeUndefined();
  });
});

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
const store = (port: SidecarPort) => new PaperSidecarStore(port, { now: () => '2026-10-07T12:00:00.000Z', newId: () => `id-${++seq}` });

describe('PaperSidecarStore', () => {
  it('returns empty data when the sidecar is absent or corrupt', async () => {
    expect(await store(memoryPort()).load('p')).toEqual(createEmptyPaperSidecar());
    expect(await store(memoryPort({ p: '{not json' })).load('p')).toEqual(createEmptyPaperSidecar());
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

  it('records a deletion marker and drops markers older than 90 days on every write', async () => {
    const old = { id: 'gone', deletedAt: '2026-06-01T00:00:00.000Z' };
    const fresh = { id: 'kept', deletedAt: '2026-09-01T00:00:00.000Z' };
    const port = memoryPort({ p: JSON.stringify({ annotations: [], theme: 'auto', deleted: [old, fresh] }) });
    const s = store(port);
    const a = await s.addNote('p', 1, 'n');
    expect(JSON.parse(port.files['p']!).deleted).toEqual([fresh]);
    await s.deleteAnnotation('p', a.id);
    expect(JSON.parse(port.files['p']!).deleted).toEqual([{ id: a.id, deletedAt: '2026-10-07T12:00:00.000Z' }, fresh]);
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

describe('PaperSidecarStore theme and reading state', () => {
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

describe('PaperSidecarStore annotations', () => {
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

describe('PaperSidecarStore logging', () => {
  it('logs a warning when the sidecar does not parse, and still loads empty data', async () => {
    const log = jest.fn(async () => undefined);
    const logger = { log, error: jest.fn(async () => undefined) };
    const s = new PaperSidecarStore(memoryPort({ p: '{not json' }), { logger });
    expect(await s.load('p')).toEqual(createEmptyPaperSidecar());
    expect(log).toHaveBeenCalledWith('WARN', 'sidecar', expect.any(String), expect.objectContaining({ paperId: 'p' }));
  });

  it('does not log for a missing sidecar', async () => {
    const log = jest.fn(async () => undefined);
    await new PaperSidecarStore(memoryPort(), { logger: { log, error: jest.fn(async () => undefined) } }).load('p');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('checkAnnotationPosition', () => {
  it('accepts a normalized box and rejects anything outside the page', () => {
    expect(checkAnnotationPosition({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
    expect(() => checkAnnotationPosition({ x: 0.9, y: 0, width: 0.2, height: 0.1 })).toThrow('normalized');
    expect(() => checkAnnotationPosition({ x: '0' })).toThrow('numbers');
    expect(() => checkAnnotationPosition(null)).toThrow('object');
  });
});

describe("createPreviewStore", () => {
  it("keeps the reading position and theme", async () => {
    const store = createPreviewStore();
    await store.setTheme("preview:p", "sepia");
    await store.setReadingState("preview:p", { page: 3, scaleValue: "1.25", updatedAt: "2026-10-15T00:00:00.000Z" });
    const data = await store.load("preview:p");
    expect(data.theme).toBe("sepia");
    expect(data.reading).toMatchObject({ page: 3 });
  });

  it.each([
    ["addHighlight", (s: ReturnType<typeof createPreviewStore>) => s.addHighlight("preview:p", 1, "text", "yellow")],
    ["addNote", (s: ReturnType<typeof createPreviewStore>) => s.addNote("preview:p", 1, "note")],
    ["updateAnnotation", (s: ReturnType<typeof createPreviewStore>) => s.updateAnnotation("preview:p", "a", "text")],
    ["deleteAnnotation", (s: ReturnType<typeof createPreviewStore>) => s.deleteAnnotation("preview:p", "a")],
  ])("rejects %s and stores nothing", async (_name, write) => {
    const store = createPreviewStore();
    await expect(write(store)).rejects.toThrow(PREVIEW_ANNOTATION_REFUSAL);
    expect(await store.getAnnotations("preview:p")).toEqual([]);
  });
});
