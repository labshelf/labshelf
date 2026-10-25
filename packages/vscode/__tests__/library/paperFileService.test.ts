/** The paper file service lists a paper folder and stores file descriptions in metadata.yaml, over the real core functions. */
import { PaperFileService } from '../../src/library/paperFileService';
import { makeGlue, PAPERS_ROOT, type Glue } from './paperServiceHarness';

const DIR = `${PAPERS_ROOT}/p1`;

async function setup(meta: Record<string, unknown> = {}) {
  const g: Glue = makeGlue();
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
