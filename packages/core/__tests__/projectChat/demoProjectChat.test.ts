/** Checks the demo Project chat: its seed, and that send, edit and remove change only the user's own messages and notify. */
import { createDemoProjectChat } from '../../src/projectChat/index.js';

const now = (): Date => new Date('2026-11-09T15:00:00');

test('seeds messages over yesterday and today with Ana and Kenji online and Ana typing', () => {
  const chat = createDemoProjectChat({ projectTitle: 'Thermal', author: 'Luca', now });
  const messages = chat.messages();
  expect(messages.length).toBeGreaterThanOrEqual(5);
  expect(new Set(messages.map(m => m.author))).toEqual(new Set(['Ana', 'Kenji', 'Luca']));
  expect(new Set(messages.map(m => new Date(m.created).toDateString())).size).toBe(2);
  expect(messages.some(m => m.edited)).toBe(true);
  expect(chat.peers().map(p => [p.name, p.typing])).toEqual([['Ana', true], ['Kenji', false]]);
  expect(chat.author).toBe('Luca');
  expect(chat.canWrite).toBe(true);
});

test('send, edit and remove act on own messages only and notify', () => {
  const chat = createDemoProjectChat({ projectTitle: 'Thermal', author: 'Luca', now });
  const listener = jest.fn();
  chat.onChange(listener);
  chat.send('Hello');
  const sent = chat.messages().at(-1)!;
  expect(sent).toMatchObject({ author: 'Luca', body: 'Hello' });
  chat.send('   ');
  expect(listener).toHaveBeenCalledTimes(1);
  chat.edit(sent.id, 'Hello again');
  expect(chat.messages().at(-1)).toMatchObject({ body: 'Hello again', edited: now().toISOString() });
  const other = chat.messages().find(m => m.author === 'Ana')!;
  chat.edit(other.id, 'changed');
  chat.remove(other.id);
  expect(chat.messages().find(m => m.id === other.id)?.body).toBe(other.body);
  expect(listener).toHaveBeenCalledTimes(2);
  chat.remove(sent.id);
  expect(chat.messages().some(m => m.id === sent.id)).toBe(false);
  expect(listener).toHaveBeenCalledTimes(3);
});

test('dispose drops the listeners', () => {
  const chat = createDemoProjectChat({ projectTitle: 'Thermal', author: 'Luca', now });
  const listener = jest.fn();
  chat.onChange(listener);
  chat.dispose();
  chat.send('Hello');
  expect(listener).not.toHaveBeenCalled();
});
