import { createSelectionSources } from '../../../src/libraryUi/details/index';

function setup(hub: { publish: jest.Mock; activate: jest.Mock }) {
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  return { logger, sources: createSelectionSources({ ...hub, current: () => null } as never, logger as never) };
}

describe('createSelectionSources', () => {
  it('publishes papers, projects and the reader paper, and clears on an empty selection', () => {
    const hub = { publish: jest.fn(), activate: jest.fn() };
    const { sources } = setup(hub);
    sources.listSelected(['a', 'b']);
    sources.listSelected([]);
    sources.projectSelected('proj');
    sources.projectSelected(null);
    sources.readerActivated('r');
    expect(hub.publish.mock.calls).toEqual([
      ['list', { kind: 'paper', ids: ['a', 'b'] }], ['list', null],
      ['projects', { kind: 'project', id: 'proj' }], ['projects', null],
      ['reader', { kind: 'paper', ids: ['r'] }],
    ]);
  });

  it('activates the list and projects sources', () => {
    const hub = { publish: jest.fn(), activate: jest.fn() };
    const { sources } = setup(hub);
    sources.listActivated();
    sources.projectsActivated();
    expect(hub.activate.mock.calls).toEqual([['list'], ['projects']]);
  });

  it('logs a hub failure instead of throwing', () => {
    const hub = { publish: jest.fn(() => { throw new Error('boom'); }), activate: jest.fn() };
    const { sources, logger } = setup(hub);
    expect(() => sources.listSelected(['a'])).not.toThrow();
    expect(logger.log).toHaveBeenCalledWith('ERROR', 'details.sources', 'Details selection failed', expect.objectContaining({ message: 'boom' }));
  });
});
