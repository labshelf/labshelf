/** The list host leaves the sharing channel to the sharing server and warns only about other messages it cannot read. */
import { handleListMessage } from '../../../../src/ui/list/host/messageHandler';
import type { ListHostContext } from '../../../../src/ui/list/host/hostContext';

function context() {
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const ctx = { deps: { logger }, paths: () => null, post: jest.fn(), notice: jest.fn() } as unknown as ListHostContext;
  return { ctx, logger };
}

describe('handleListMessage', () => {
  it('ignores a sharing message without a warning', async () => {
    const { ctx, logger } = context();
    await handleListMessage(ctx, { channel: 'sharing', type: 'hello' });
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('warns about a message that is not valid', async () => {
    const { ctx, logger } = context();
    await handleListMessage(ctx, { type: 'nonsense' });
    expect(logger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.any(String), { type: 'nonsense' });
  });
});
