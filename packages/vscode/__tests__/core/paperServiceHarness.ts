/** The paper glue over the real core mutations: an in-memory disk, a LibraryStore scanning it, and an event spy. */
import * as path from 'node:path';
import { BibTeXService, LibraryStore, scanLibrary, type ILogger, type MutationContext, type PaperRecord } from '@labshelf/core';

import { PaperImporter } from '../../src/core/paperImporter';
import { PaperService } from '../../src/core/paperService';
import { PaperTextLayers } from '../../src/core/paperTextLayers';
import { reindexLibrary, type ReindexSummary } from '../../src/storage/data/reindexLibrary';
import { MemoryLibraryFs } from '../support/memoryLibraryFs';
import type { EventBus } from '../../src/events/index.js';

export const PAPERS_ROOT = '/lib/papers';

// JSON values are valid YAML flow scalars and sequences.
const asYaml = (meta: Record<string, unknown>): string =>
  Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join('');

export const pdfBytes = (body = 'fake'): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);

export interface Glue {
  fs: MemoryLibraryFs;
  ctx: MutationContext;
  store: LibraryStore;
  rows: PaperRecord[];
  emitted: Array<[string, unknown]>;
  /** How many times the index was rebuilt from disk; a no-op change does not reindex. */
  reindexCalls: () => number;
  service: PaperService;
  importer: PaperImporter;
  textLayers: (builder?: { build?: jest.Mock; detect?: jest.Mock }) => PaperTextLayers;
  parse: jest.Mock;
  /** Writes a paper to disk (hasPdf: false skips writing paper.pdf), then reloads the store so it is indexed. */
  seed: (id: string, meta?: Record<string, unknown> & { hasPdf?: boolean }, dir?: string) => Promise<PaperRecord>;
}

export function makeGlue(): Glue {
  const fs = new MemoryLibraryFs();
  const emitted: Array<[string, unknown]> = [];
  const eventBus = { emit: jest.fn((name: string, payload: unknown) => { emitted.push([name, payload]); }) } as unknown as EventBus;
  const logger: ILogger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const bibtex = new BibTeXService(fs);
  const ctx: MutationContext = { fs, paths: path, artifacts: bibtex, logger, papersRoot: PAPERS_ROOT, now: () => '2026-01-01T00:00:00.000Z' };
  const parse = jest.fn(async () => ({ title: 'Test Paper', citeKey: 'testpaper2024', authors: ['Alice'], year: 2024 }));

  const scan = () => scanLibrary(fs, path, PAPERS_ROOT, logger);
  const store = new LibraryStore({ root: PAPERS_ROOT, scan, filterFor: () => undefined });
  let reindexCalls = 0;
  const reindex = (): Promise<ReindexSummary> => {
    reindexCalls += 1;
    return reindexLibrary({ store, eventBus });
  };

  const service = new PaperService(ctx, store, reindex, eventBus, parse);
  const importer = new PaperImporter(
    ctx, store, reindex, parse,
    { tmpDir: '/lib/tmp', download: { fetch: jest.fn() as unknown as typeof fetch, headers: { 'User-Agent': 'LabShelf-VSCode/test' } } },
  );
  void fs.mkdir(PAPERS_ROOT);
  return {
    fs, ctx, store, emitted, parse,
    get rows() { return [...store.snapshot.papers.values()].map((entry) => entry.record); },
    reindexCalls: () => reindexCalls,
    service, importer,
    textLayers: (builder) => new PaperTextLayers(ctx, service, builder as never),
    async seed(id, meta = {}, dir = PAPERS_ROOT) {
      const { hasPdf = true, ...rest } = meta;
      const folder = `${dir}/${id}`;
      await fs.writeText(`${folder}/metadata.yaml`, asYaml({ title: `Title ${id}`, status: 'unread', ...rest }));
      if (hasPdf) { await fs.writeFile(`${folder}/paper.pdf`, pdfBytes()); }
      await store.reload();
      const found = store.paper(id);
      if (!found) { throw new Error(`seed(${id}) did not appear in the store after reload`); }
      return found.record;
    },
  };
}
