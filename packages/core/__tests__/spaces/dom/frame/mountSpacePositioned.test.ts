/** Checks the positioned Space surfaces and their unavailable controls.
 * @jest-environment jsdom
 */
import { mountSpacePositioned } from '../../../../src/spaces/dom/frame/mountSpacePositioned.js';

test.each([
  ['notes', ['New note', 'Space notes', 'Paper notes', 'No Space notes yet.', 'No Paper notes yet.']],
  ['discussions', ['New topic', 'Topics', 'Decisions', 'Tasks', 'No topics yet.', 'No discussion selected.']],
  ['discover', ['All', 'Gaps', 'For this project', 'Later versions', 'No suggestions yet.', 'arXiv alerts', 'Watch']],
] as const)('renders the %s layout with explained unavailable controls', (tab, labels) => {
  const root = document.createElement('div');
  const dispose = mountSpacePositioned(root, tab);
  for (const label of labels) expect(root.textContent).toContain(label);
  const controls = [...root.querySelectorAll<HTMLElement>('button, input, textarea, select')];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.title).not.toBe('');
    expect(control.hasAttribute('disabled')).toBe(false);
    expect(control.dispatchEvent(new MouseEvent('click', { cancelable: true }))).toBe(false);
    expect(control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(false);
  }
  for (const input of root.querySelectorAll<HTMLInputElement>('input')) expect(input.readOnly).toBe(true);
  dispose();
  expect(root.childElementCount).toBe(0);
});
