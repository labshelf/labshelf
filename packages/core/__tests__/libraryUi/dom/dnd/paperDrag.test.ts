/** Tests paper drag operations across folder and Space targets.
 * @jest-environment jsdom
 */
import { createLoopbackTransport, type UiToHost } from '../../../../src/libraryUi/protocol/index.js';
import { makeDropTarget, startPaperDrag } from '../../../../src/libraryUi/dom/dnd/index.js';

test('permits copying a reference into Spaces and moving a paper into folders', () => {
  const root = document.createElement('div');
  const data = new Map<string, string>();
  const transfer = { effectAllowed: 'none', setData: (key: string, value: string) => data.set(key, value) };
  const event = { dataTransfer: transfer } as unknown as DragEvent;
  startPaperDrag({ root }, event, ['paper'], 'A paper');
  expect(transfer.effectAllowed).toBe('copyMove');
  expect(data.get('application/x-labshelf-papers')).toBe('["paper"]');
});

test.each(['null', '{}', '[1]', '[""]', '[" "]', '{', '"paper"'])('rejects malformed folder-drop ids: %s', payload => {
  const { ui, host } = createLoopbackTransport();
  const sent: UiToHost[] = []; host.subscribe(m => sent.push(m));
  const target = document.createElement('div');
  makeDropTarget({ transport: ui }, target, 'papers/folder');
  const event = new Event('drop', { cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['application/x-labshelf-papers'], getData: () => payload } });
  target.dispatchEvent(event);
  expect(sent).toEqual([]);
});
