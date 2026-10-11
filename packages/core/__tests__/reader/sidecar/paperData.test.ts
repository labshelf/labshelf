// Tests normalization and serialization of paper data.
import { emptyPaperData, normalizePaperData, serializePaperData } from '../../../src/reader/sidecar/paperData';

describe('normalizePaperData', () => {
  it('returns empty data for anything that is not an object', () => {
    expect(normalizePaperData(null)).toEqual(emptyPaperData());
    expect(normalizePaperData([])).toEqual(emptyPaperData());
    expect(normalizePaperData('x')).toEqual(emptyPaperData());
  });

  it('drops malformed annotations, unknown themes and an unusable reading state', () => {
    const data = normalizePaperData({ annotations: [{ id: 'a' }, { nope: 1 }, null], theme: 'neon', reading: { page: 0 } });
    expect(data.annotations).toEqual([{ id: 'a' }]);
    expect(data.theme).toBe('auto');
    expect(data.reading).toBeUndefined();
  });

  it('keeps a valid reading state', () => {
    const data = normalizePaperData({ annotations: [], theme: 'sepia', reading: { page: 3, scaleValue: 'page-width', updatedAt: 't' } });
    expect(data.theme).toBe('sepia');
    expect(data.reading).toEqual({ page: 3, scaleValue: 'page-width', updatedAt: 't' });
  });
});

describe('serializePaperData', () => {
  it('writes the VS Code sidecar format: fixed key order, two-space indent, reading only when set', () => {
    expect(serializePaperData({ annotations: [], theme: 'auto' })).toBe('{\n  "annotations": [],\n  "theme": "auto"\n}');
    const withReading = serializePaperData({ reading: { page: 2, scaleValue: '1.5', updatedAt: 't' }, theme: 'dark', annotations: [] });
    expect(Object.keys(JSON.parse(withReading))).toEqual(['annotations', 'theme', 'reading']);
  });
});
