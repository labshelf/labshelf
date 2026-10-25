// Tests normalization and serialization of paper data.
import { createEmptyPaperSidecar, normalizePaperSidecar, serializePaperSidecar } from '../../../src/reader/sidecar/paperSidecar';

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
