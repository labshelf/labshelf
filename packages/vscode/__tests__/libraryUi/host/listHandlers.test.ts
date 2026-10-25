/** The list host leaves the sharing channel to the sharing server and warns only about other messages it cannot read. */
import { answerListMessage } from '../../../src/libraryUi/host/listHandlers';
import type { ListHostContext } from '../../../src/libraryUi/host/hostContext';

function context() {
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const ctx = { deps: { logger }, paths: () => null, post: jest.fn(), notice: jest.fn() } as unknown as ListHostContext;
  return { ctx, logger };
}

describe('answerListMessage', () => {
  it('ignores a sharing message without a warning', async () => {
    const { ctx, logger } = context();
    await answerListMessage(ctx, { channel: 'sharing', type: 'hello' });
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('warns about a message that is not valid', async () => {
    const { ctx, logger } = context();
    await answerListMessage(ctx, { type: 'nonsense' });
    expect(logger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.any(String), { type: 'nonsense' });
  });
});


it('adds paper references through the Space host and confirms success', async () => {
  const { ctx } = context();
  ctx.deps.addToSpace = jest.fn(async () => true);
  await answerListMessage(ctx, { type: 'paper.addToSpace', ids: ['paper-a'] });
  expect(ctx.deps.addToSpace).toHaveBeenCalledWith(['paper-a']);
  expect(ctx.notice).toHaveBeenCalledWith('ok', 'Added to Space');
});

it('surfaces failures adding paper references', async () => {
  const { ctx, logger } = context();
  ctx.deps.addToSpace = jest.fn(async () => { throw new Error('Disk unavailable'); });
  await answerListMessage(ctx, { type: 'paper.addToSpace', ids: ['paper-a'] });
  expect(logger.log).toHaveBeenCalledWith('ERROR', expect.any(String), expect.any(String), expect.any(Object));
  expect(ctx.notice).toHaveBeenCalledWith('error', expect.stringContaining('Disk unavailable'));
});
