/**
 * Tests that metadata.yaml — what the index is rebuilt from on every start —
 * carries every field the library shows, and that rewriting it after import
 * keeps the name of the file the user originally imported.
 */
import YAML from 'yaml';

import { BibtexService, createPaperRecord, parsePaperMetadata } from '@labshelf/core';
import type { IFileSystem, PaperRecord } from '@labshelf/core';

function memoryFs(initial: Record<string, string> = {}): IFileSystem & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    ensureDir: async () => undefined,
    writeText: async (p, content) => { files.set(p, content); },
    readText: async (p) => {
      const value = files.get(p);
      if (value === undefined) { throw new Error(`ENOENT ${p}`); }
      return value;
    },
    exists: async (p) => files.has(p),
  };
}

const paper = (overrides: Partial<PaperRecord> = {}): PaperRecord => ({
  id: 'imai1986', title: 'Efficient Algorithms', path: '/lib/papers/imai1986', citeKey: 'imai1986', status: 'unread', ...overrides,
});
const metadata = (fs: ReturnType<typeof memoryFs>) => YAML.parse(fs.files.get('/lib/papers/imai1986/metadata.yaml')!);

describe('BibTeXService.writePaperArtifacts', () => {
  it('writes the abstract, keywords and text layer so a restart does not drop them', async () => {
    const fs = memoryFs();
    const textLayer = { state: 'ocr' as const, ocrPages: 17, checkedAt: '2026-10-07T12:00:00.000Z' };

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({
      summary: 'In this paper, we show…', keywords: ['graph search'], textLayer,
    }), '/Users/me/Downloads/artigo-comp.pdf');

    expect(metadata(fs)).toMatchObject({ summary: 'In this paper, we show…', keywords: ['graph search'], textLayer, source: 'artigo-comp.pdf' });
  });

  it('keeps the original source name when rewriting from the library copy', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\nsource: artigo-comp.pdf\n' });

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), '/lib/papers/imai1986/paper.pdf');

    expect(metadata(fs).source).toBe('artigo-comp.pdf');
  });

  it('falls back to paper.pdf when there is no earlier name to keep', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': ':: not yaml' });

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');

    expect(metadata(fs).source).toBe('paper.pdf');
  });

  it('writes the tags a browser save attaches', async () => {
    const fs = memoryFs();

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ tags: ['geometry', 'to-read'] }), 'paper.pdf');

    expect(metadata(fs)).toMatchObject({ tags: ['geometry', 'to-read'] });
  });

  it('keeps tags and hand-added keys (a note key included) when a surface that does not know them rewrites the sidecar', async () => {
    const fs = memoryFs({
      '/lib/papers/imai1986/metadata.yaml': 'title: Old\nstatus: unread\ntags: [geometry]\nnote: Cited in ch. 3\nrating: 5\n',
    });

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ status: 'done' }), 'paper.pdf');

    expect(metadata(fs)).toMatchObject({ title: 'Efficient Algorithms', status: 'done', tags: ['geometry'], note: 'Cited in ch. 3', rating: 5 });
  });

  it('clears tags when the record explicitly empties them, and keeps a foreign note key', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\ntags: [geometry]\nnote: old\n' });

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ tags: [] }), 'paper.pdf');

    expect(metadata(fs)).not.toHaveProperty('tags');
    expect(metadata(fs)).toMatchObject({ note: 'old' });
  });

  it('never carries over a stale value for a field it owns', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\ndoi: 10.1/old\nsummary: stale\n' });

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');

    expect(metadata(fs)).not.toHaveProperty('doi');
    expect(metadata(fs)).not.toHaveProperty('summary');
  });

  it('writes the bib file line only when paper.pdf is in the folder', async () => {
    const withPdf = memoryFs({ '/lib/papers/imai1986/paper.pdf': 'PDF' });
    await new BibtexService(withPdf).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');
    expect(withPdf.files.get('/lib/papers/imai1986/bib.bib')).toContain('file = {');

    // The browser saves a reference with no paper.pdf when it finds none: the
    // entry must not point LaTeX at a file that is not there.
    const noPdf = memoryFs();
    await new BibtexService(noPdf).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');
    expect(noPdf.files.get('/lib/papers/imai1986/bib.bib')).not.toContain('file =');
  });

  it('writes numeric-looking strings quoted so they read back as the same string', async () => {
    const fs = memoryFs();

    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ volume: '15', pages: '12' }), 'paper.pdf');

    const meta = parsePaperMetadata(fs.files.get('/lib/papers/imai1986/metadata.yaml')!)!;
    const record = createPaperRecord(meta, { id: 'imai1986', path: '/lib/papers/imai1986', hasPdf: false });
    expect(record.volume).toBe('15');
    expect(record.pages).toBe('12');
  });

  describe('pdfVersion', () => {
    const write = (fs: ReturnType<typeof memoryFs>, pdfVersion?: PaperRecord['pdfVersion']) =>
      new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(pdfVersion === undefined ? {} : { pdfVersion }), 'paper.pdf');

    it('writes the version a record carries and reads it back', async () => {
      const fs = memoryFs();
      await write(fs, 'accepted');
      expect(metadata(fs).pdfVersion).toBe('accepted');
      const meta = parsePaperMetadata(fs.files.get('/lib/papers/imai1986/metadata.yaml')!)!;
      expect(createPaperRecord(meta, { id: 'imai1986', path: '/lib/papers/imai1986', hasPdf: true }).pdfVersion).toBe('accepted');
    });

    it('replaces the file value with the record value', async () => {
      const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\npdfVersion: preprint\n' });
      await write(fs, 'published');
      expect(metadata(fs).pdfVersion).toBe('published');
    });

    it('keeps the file value when the record does not know the version', async () => {
      const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\npdfVersion: preprint\n' });
      await write(fs);
      expect(metadata(fs).pdfVersion).toBe('preprint');
    });

    it('removes the key when the record says the version is unknown', async () => {
      const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\npdfVersion: preprint\n' });
      await write(fs, null);
      expect(metadata(fs)).not.toHaveProperty('pdfVersion');
    });

    it('writes none for a library file that never had one', async () => {
      const fs = memoryFs();
      await write(fs);
      expect(metadata(fs)).not.toHaveProperty('pdfVersion');
    });
  });

  describe('pdfRequestedAt', () => {
    const write = (fs: ReturnType<typeof memoryFs>, pdfRequestedAt?: PaperRecord['pdfRequestedAt']) =>
      new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(pdfRequestedAt === undefined ? {} : { pdfRequestedAt }), 'paper.pdf');

    it('writes the day a record carries and reads it back', async () => {
      const fs = memoryFs();
      await write(fs, '2026-10-15');
      expect(metadata(fs).pdfRequestedAt).toBe('2026-10-15');
      const meta = parsePaperMetadata(fs.files.get('/lib/papers/imai1986/metadata.yaml')!)!;
      expect(createPaperRecord(meta, { id: 'imai1986', path: '/lib/papers/imai1986', hasPdf: false }).pdfRequestedAt).toBe('2026-10-15');
    });

    it('keeps the file value when the record does not know the day', async () => {
      const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\npdfRequestedAt: 2026-10-01\n' });
      await write(fs);
      expect(metadata(fs).pdfRequestedAt).toBe('2026-10-01');
    });

    it('removes the key when the record says null', async () => {
      const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\npdfRequestedAt: 2026-10-01\n' });
      await write(fs, null);
      expect(metadata(fs)).not.toHaveProperty('pdfRequestedAt');
    });

    it('writes none for a library file that never had one', async () => {
      const fs = memoryFs();
      await write(fs);
      expect(metadata(fs)).not.toHaveProperty('pdfRequestedAt');
    });
  });
});

describe('BibTeXService.writePaperArtifacts statusChangedAt', () => {
  it('writes statusChangedAt and reads it back', async () => {
    const fs = memoryFs();
    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ statusChangedAt: '2026-10-15T10:00:00.000Z' }), 'paper.pdf');

    expect(metadata(fs).statusChangedAt).toBe('2026-10-15T10:00:00.000Z');
    const meta = parsePaperMetadata(fs.files.get('/lib/papers/imai1986/metadata.yaml')!)!;
    expect(createPaperRecord(meta, { id: 'imai1986', path: '/lib/papers/imai1986', hasPdf: false }).statusChangedAt).toBe('2026-10-15T10:00:00.000Z');
  });

  it('writes no statusChangedAt key when the paper has none', async () => {
    const fs = memoryFs();
    await new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');

    expect(metadata(fs)).not.toHaveProperty('statusChangedAt');
  });
});
