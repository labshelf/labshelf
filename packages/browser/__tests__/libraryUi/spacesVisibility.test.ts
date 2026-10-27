/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins Space reloads when another extension surface changes the library.
import { createLoopbackTransport } from '@labshelf/core';
import { createPageSpaces } from '../../src/libraryUi/spaces';
import { memoryLibraryFs } from '../support/memoryLibraryFs';

let runtime: (message: unknown) => void;
const removeListener = jest.fn();
jest.mock('webextension-polyfill', () => ({ __esModule: true, default: { runtime: { onMessage: {
  addListener: (listener: typeof runtime) => { runtime = listener; }, removeListener: (...args: unknown[]) => removeListener(...args),
} } } }));
jest.mock('../../src/storage', () => ({ ...jest.requireActual('../../src/storage'), onPaperRecordsRebuilt: () => jest.fn() }));

it('reloads for library.changed and visibility, then removes its listeners', async () => {
  const logger = { log: jest.fn(async () => {}), error: jest.fn() } as never;
  const spaces = createPageSpaces({
    fs: memoryLibraryFs(), logger, transport: createLoopbackTransport().ui, workspace: () => ({}) as never,
    selection: {} as never, projects: () => null, openProject: async () => {},
  });
  const reload = jest.spyOn(spaces.store, 'reload').mockResolvedValue(undefined as never);
  const stop = spaces.dispose;
  runtime({ type: 'unrelated' });
  expect(reload).not.toHaveBeenCalled();
  expect(runtime({ type: 'library.changed', reason: 'annotations' })).toBeUndefined();
  expect(reload).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(reload).toHaveBeenCalledTimes(2);
  stop();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(reload).toHaveBeenCalledTimes(2);
  expect(removeListener).toHaveBeenCalledWith(runtime);
});
