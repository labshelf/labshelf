// Tests that metadata.yaml writes and keeps the `files` map of file descriptions and the keys around it.
import YAML from 'yaml';

import { BibtexService, createPaperRecord, parsePaperMetadata } from '@labshelf/core';
import type { IFileSystem, PaperRecord } from '@labshelf/core';

const YAML_PATH = '/lib/papers/imai1986/metadata.yaml';

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
const write = (fs: ReturnType<typeof memoryFs>, overrides?: Partial<PaperRecord>) =>
  new BibtexService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(overrides), 'paper.pdf');
const metadata = (fs: ReturnType<typeof memoryFs>) => YAML.parse(fs.files.get(YAML_PATH)!);

describe('metadata.yaml files key', () => {
  it('writes the descriptions a record carries and reads them back', async () => {
    const fs = memoryFs();
    await write(fs, { files: { 'notes.md': 'My notes', data: 'Raw' } });
    expect(metadata(fs).files).toEqual({ 'notes.md': 'My notes', data: 'Raw' });
    const meta = parsePaperMetadata(fs.files.get(YAML_PATH)!)!;
    expect(createPaperRecord(meta, { id: 'imai1986', path: '/lib/papers/imai1986', hasPdf: false }).files).toEqual({ 'notes.md': 'My notes', data: 'Raw' });
  });

  it('replaces the file value with the record value', async () => {
    const fs = memoryFs({ [YAML_PATH]: 'title: Old\nfiles:\n  a.txt: old\n' });
    await write(fs, { files: { 'b.txt': 'new' } });
    expect(metadata(fs).files).toEqual({ 'b.txt': 'new' });
  });

  it('keeps the file value when the record has no files', async () => {
    const fs = memoryFs({ [YAML_PATH]: 'title: Old\nfiles:\n  a.txt: kept\n' });
    await write(fs);
    expect(metadata(fs).files).toEqual({ 'a.txt': 'kept' });
  });

  it('removes the file key when the record has an empty files map', async () => {
    const fs = memoryFs({ [YAML_PATH]: 'title: Old\nfiles:\n  a.txt: gone\n' });
    await write(fs, { files: {} });
    expect(metadata(fs)).not.toHaveProperty('files');
  });

  it('writes none for a library file that never had one', async () => {
    const fs = memoryFs();
    await write(fs);
    expect(metadata(fs)).not.toHaveProperty('files');
  });

  it('keeps unknown keys when the descriptions change', async () => {
    const fs = memoryFs({ [YAML_PATH]: 'title: Old\ncustomKey: keep me\nvscodeOnly:\n  nested: [a, b]\n' });
    await write(fs, { files: { 'a.txt': 'x' } });
    expect(metadata(fs)).toMatchObject({ customKey: 'keep me', vscodeOnly: { nested: ['a', 'b'] }, files: { 'a.txt': 'x' } });
  });
});
