/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins Space reloads when another extension surface changes the library.
import { watchSpaces } from '../../src/spaces';

let runtime: (message: unknown) => void;
const removeListener = jest.fn();
jest.mock('../../src/platform', () => ({ bx: { runtime: { onMessage: {
  addListener: (listener: typeof runtime) => { runtime = listener; }, removeListener: (...args: unknown[]) => removeListener(...args),
} } } }));
jest.mock('../../src/storage', () => ({ onPaperRecordsRebuilt: () => jest.fn() }));

it('reloads for library.changed and visibility, then removes its listeners', async () => {
  const reload = jest.fn(async () => {});
  const logger = { error: jest.fn() } as never;
  const stop = watchSpaces(reload, logger);
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
