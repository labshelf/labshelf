/** Checks research chat context and its unavailable controls.
 * @jest-environment jsdom
 */
import { mountResearchChat } from '../../../src/spaces/dom/mountResearchChat.js';

test('renders the context, suggestions, composer and disconnected model footer', () => {
  const root = document.createElement('div');
  const chat = mountResearchChat(root, { context: 'My Space' });
  expect(root.querySelector('.chat-context-name')?.textContent).toBe('My Space');
  expect(root.querySelectorAll('.chat-suggestion')).toHaveLength(3);
  expect(root.querySelector('[aria-live="polite"]')).not.toBeNull();
  expect(root.querySelector('.chat-privacy')?.textContent).toBe('No model connected');
  for (const control of root.querySelectorAll<HTMLElement>('button, textarea')) {
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.title).toBe('Needs a connected model');
    expect(control.hasAttribute('disabled')).toBe(false);
    expect(control.dispatchEvent(new MouseEvent('click', { cancelable: true }))).toBe(false);
    expect(control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(false);
  }
  expect(root.querySelector('textarea')?.readOnly).toBe(true);
  chat.dispose();
  expect(root.childElementCount).toBe(0);
});

test('updates the context as plain text and falls back to Library without a selection', () => {
  const root = document.createElement('div');
  const chat = mountResearchChat(root, { context: null });
  expect(root.querySelector('.chat-context-name')?.textContent).toBe('Library');
  chat.setContext('<Project>');
  expect(root.querySelector('.chat-context-name')?.textContent).toBe('<Project>');
  expect(root.querySelector('project')).toBeNull();
  chat.setContext(null);
  expect(root.querySelector('.chat-context-name')?.textContent).toBe('Library');
  chat.dispose();
});
