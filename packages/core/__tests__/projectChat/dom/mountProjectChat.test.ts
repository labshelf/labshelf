/** Checks the Project chat surface over the demo source: messages, day separators, own side, the composer's keys, own-only actions,
 *  the empty state and switching projects.
 * @jest-environment jsdom
 */
import { createDemoProjectChat } from '../../../src/projectChat/index.js';
import { mountProjectChat } from '../../../src/projectChat/dom/index.js';

const now = (): Date => new Date('2026-11-09T15:00:00');
const demo = (title = 'Thermal') => createDemoProjectChat({ projectTitle: title, author: 'Luca', now });

function mount(source = demo()) {
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountProjectChat(root, { source, projectTitle: 'Thermal' });
  const input = root.querySelector<HTMLTextAreaElement>('textarea.ds-input')!;
  const type = (text: string): void => { input.value = text; input.dispatchEvent(new Event('input')); };
  const key = (init: KeyboardEventInit): void => { input.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })); };
  return { root, handle, source, input, type, key };
}

afterEach(() => { document.body.replaceChildren(); });

test('renders the project name as head, the preview note, day separators, typing line and own messages as You', () => {
  const { root } = mount();
  expect(root.querySelector('.ds-thread-title h2')?.textContent).toBe('Thermal');
  expect(root.querySelector('.pc-preview')?.textContent).toBe('Preview: messages are not saved or shared yet.');
  expect(root.querySelector('.ds-online')).toBeNull();
  expect(root.querySelectorAll('.ds-day')).toHaveLength(2);
  expect(root.querySelector('.ds-typing')?.textContent).toBe('Ana is typing…');
  const own = root.querySelectorAll('.ds-message.own');
  expect(own).toHaveLength(1);
  expect(own[0]!.querySelector('strong')?.textContent).toBe('You');
  expect(own[0]!.querySelector('.ds-avatar')).toBeNull();
  expect(root.querySelector('.ds-message:not(.own) .ds-avatar')).not.toBeNull();
  expect(root.querySelector('.ds-edited')?.textContent).toBe('(edited)');
  expect(root.querySelector('.ds-hint')?.textContent).toBe('Enter sends, Shift+Enter adds a line');
});

test('sends with the button and with Enter; Shift+Enter does not send', () => {
  const { root, source, type, key, input } = mount();
  const count = source.messages().length;
  const send = root.querySelector<HTMLButtonElement>('.ds-send')!;
  expect(send.disabled).toBe(true);
  type('From the button');
  expect(send.disabled).toBe(false);
  send.click();
  expect(source.messages()).toHaveLength(count + 1);
  expect(input.value).toBe('');
  expect([...root.querySelectorAll('.ds-message.own .pc-body')].at(-1)?.textContent).toBe('From the button');
  type('Two');
  key({ key: 'Enter', shiftKey: true });
  expect(source.messages()).toHaveLength(count + 1);
  key({ key: 'Enter' });
  expect(source.messages().at(-1)?.body).toBe('Two');
});

test('offers Edit and Delete on own messages only, edits inline and deletes after confirming', async () => {
  const { root, source } = mount();
  for (const message of root.querySelectorAll('.ds-message:not(.own)')) {
    expect(message.querySelector('[aria-label="Edit"]')).toBeNull();
    expect(message.querySelector('[aria-label="Delete"]')).toBeNull();
    expect(message.querySelector('[aria-label="Reply quoting"]')).not.toBeNull();
  }
  const ownId = source.messages().find(m => m.author === 'Luca')!.id;
  root.querySelector<HTMLButtonElement>('.ds-message.own [aria-label="Edit"]')!.click();
  const area = root.querySelector<HTMLTextAreaElement>('.ds-edit textarea')!;
  area.value = 'Edited text';
  area.dispatchEvent(new Event('input'));
  [...root.querySelectorAll<HTMLButtonElement>('.ds-edit button')].find(b => b.textContent === 'Save')!.click();
  expect(source.messages().find(m => m.id === ownId)).toMatchObject({ body: 'Edited text' });
  expect(root.querySelector('.ds-message.own .ds-edited')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('.ds-message.own [aria-label="Delete"]')!.click();
  await Promise.resolve();
  const accept = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Delete' && !b.closest('.ds-message'))!;
  expect(accept).toBeDefined();
  expect(source.messages().some(m => m.id === ownId)).toBe(true);
  accept.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(source.messages().some(m => m.id === ownId)).toBe(false);
  expect(root.querySelector('.ds-message.own')).toBeNull();
});

test('shows the empty state without a project and switches projects, disposing the previous source', () => {
  const root = document.createElement('div');
  const handle = mountProjectChat(root, { source: null, projectTitle: null });
  expect(root.textContent).toContain('Open a project to see its chat.');
  expect(root.querySelector('.ds-messages')).toBeNull();
  const first = demo('First');
  handle.setProject('First', first);
  expect(root.querySelector('.ds-thread-title h2')?.textContent).toBe('First');
  const dispose = jest.spyOn(first, 'dispose');
  handle.setProject('Second', demo('Second'));
  expect(dispose).toHaveBeenCalled();
  expect(root.querySelector('.ds-thread-title h2')?.textContent).toBe('Second');
  expect(root.querySelector('.ds-messages')?.textContent).toContain('Second');
  handle.setProject(null, null);
  expect(root.textContent).toContain('Open a project to see its chat.');
  handle.dispose();
  expect(root.childElementCount).toBe(0);
});
