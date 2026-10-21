/** Checks manual Glossary editing through the Spaces transport.
 * @jest-environment jsdom
 */
import { mountSpaceGlossary } from '../../../../src/spaces/dom/glossary/index.js';
import type { OverviewContext, SpaceSnapshot } from '../../../../src/spaces/dom/overview/index.js';
import type { HostToSpaces, SpacesToHost } from '../../../../src/spaces/protocol/index.js';

function snapshot(): SpaceSnapshot {
  return { type: 'space', space: { id: 'study', name: 'Study', papers: [], folders: [], projects: [], dates: [], extra: {},
    invalid: { folders: [], papers: [], projects: [], dates: [] } }, overview: { timeline: [], projects: [], focus: [] },
    papers: { folders: [], papers: [] }, projects: [], glossary: { terms: [
      { id: 'one', term: 'First', definition: 'Definition', symbol: ' X ', source: { paperId: 'paper', page: 4, extra: {} }, extra: {} },
      { id: 'two', term: 'Second', definition: 'Other meaning', symbol: 'x', extra: {} }] } };
}
function mount(data = snapshot()) {
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const ctx: OverviewContext = { data, readOnly: !!data.readOnlyReason, end: {
    post: m => sent.push(m), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } } };
  const root = document.createElement('div'); document.body.append(root);
  const body = mountSpaceGlossary(root, ctx);
  return { root, sent, ...body, subscriptions: () => listeners.size, receive: (m: HostToSpaces) => [...listeners].forEach(fn => fn(m)) };
}
function click(text: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  expect(button).toBeDefined(); button.click();
}
function field(name: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
}
const submit = () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
afterEach(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.body.replaceChildren(); });

test('requires term and definition before saving a draft', () => {
  const c = mount(); click('Add term'); submit(); field('term', 'Term'); submit();
  expect(c.sent.some(m => m.type === 'addTerm')).toBe(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('definition');
  field('definition', 'Definition'); submit();
  expect(c.sent).toContainEqual({ type: 'addTerm', id: 'study', term: { term: 'Term', definition: 'Definition' } });
  c.dispose();
});

test('edits a term with its source and opens that paper', () => {
  const c = mount(); click('paper, p. 4');
  expect(c.sent).toContainEqual({ type: 'openPaper', paperId: 'paper' });
  click('Edit'); field('definition', 'Edited'); submit();
  expect(c.sent).toContainEqual({ type: 'updateTerm', id: 'study', termId: 'one',
    term: { term: 'First', definition: 'Edited', symbol: 'X', source: { paperId: 'paper', page: 4 } } });
  c.dispose();
});

test('flags every term sharing a normalized symbol and keeps planned controls inert', () => {
  const c = mount(); expect(c.root.querySelectorAll('.gl-term.conflict')).toHaveLength(2);
  for (const row of c.root.querySelectorAll('.gl-term')) expect(row.textContent).toContain('symbol');
  const positioned = [...c.root.querySelectorAll<HTMLElement>('[aria-disabled="true"]')];
  expect(positioned.length).toBeGreaterThanOrEqual(2);
  for (const control of positioned) { expect(control.title).not.toBe(''); control.click(); }
  expect(c.sent).toEqual([{ type: 'listPapers' }]); c.dispose();
});

test('selects source from host papers and validates optional page', () => {
  const c = mount(); click('Add term');
  expect(c.sent).toContainEqual({ type: 'listPapers' });
  c.receive({ type: 'papers', items: [{ id: 'chosen', title: 'A paper', authors: [], status: 'unread', missing: false }] });
  const select = document.querySelector<HTMLSelectElement>('[name="paperId"]')!;
  select.value = 'chosen'; select.dispatchEvent(new Event('change', { bubbles: true }));
  field('term', 'Term'); field('definition', 'Meaning'); field('page', '0'); submit();
  expect(c.sent.some(m => m.type === 'addTerm')).toBe(false);
  field('page', '9'); submit();
  expect(c.sent).toContainEqual({ type: 'addTerm', id: 'study', term: { term: 'Term', definition: 'Meaning', source: { paperId: 'chosen', page: 9 } } });
  c.dispose();
});

test('requires confirmation to delete and closes it on disposal', () => {
  const c = mount(); click('Delete');
  expect(c.sent.some(m => m.type === 'removeTerm')).toBe(false);
  click('Cancel'); click('Delete'); click('Delete', document.querySelector('[role="alertdialog"]')!);
  expect(c.sent).toContainEqual({ type: 'removeTerm', id: 'study', termId: 'one' });
  click('Delete'); c.dispose(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

test('preserves drafts on update but blocks writes and closes dialogs when read-only', () => {
  const c = mount(); click('Add term'); field('term', 'Draft'); c.update(snapshot());
  expect(document.querySelector<HTMLInputElement>('[name="term"]')?.value).toBe('Draft');
  c.update({ ...snapshot(), glossary: { ...snapshot().glossary, readOnlyReason: 'Cannot read glossary' } });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); click('Add term'); click('Edit'); click('Delete');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(c.root.textContent).toContain('Cannot read glossary'); c.dispose();
});


test('unlocks edits after a readable glossary snapshot arrives', () => {
  const data = snapshot(); data.glossary.readOnlyReason = 'Cannot read glossary';
  const c = mount(data); click('Add term'); expect(document.querySelector('form')).toBeNull();
  c.update(snapshot()); click('Add term'); expect(document.querySelector('form')).not.toBeNull(); c.dispose();
});

test('retains missing source on edit but preserves an explicit clear during picker refresh', () => {
  const c = mount(); click('Edit');
  expect(document.querySelector<HTMLSelectElement>('[name="paperId"]')?.value).toBe('paper');
  expect(document.querySelector('select')?.textContent).not.toContain('Not in your Library');
  c.receive({ type: 'papers', items: [] });
  expect(document.querySelector('select')?.textContent).toContain('Not in your Library');
  const paper = document.querySelector<HTMLSelectElement>('[name="paperId"]')!;
  paper.value = ''; paper.dispatchEvent(new Event('change'));
  c.receive({ type: 'papers', items: [] }); submit();
  expect(c.sent).toContainEqual({ type: 'updateTerm', id: 'study', termId: 'one',
    term: { term: 'First', definition: 'Definition', symbol: 'X' } });
  click('Add term'); expect(c.subscriptions()).toBe(2); c.dispose(); expect(c.subscriptions()).toBe(0);
});


test('resolves sources across the Library without treating papers outside the Space as missing', () => {
  const c = mount();
  expect(c.sent).toContainEqual({ type: 'listPapers' });
  expect(c.root.textContent).not.toContain('Not in your Library');
  click('Add term'); field('term', 'Draft');
  c.receive({ type: 'papers', items: [{ id: 'paper', title: 'Outside the Space', authors: [], status: 'unread', missing: false }] });
  expect(c.root.textContent).toContain('Outside the Space, p. 4');
  expect(c.root.textContent).not.toContain('Not in your Library');
  expect(document.querySelector<HTMLInputElement>('[name="term"]')?.value).toBe('Draft');
  click('Outside the Space, p. 4');
  expect(c.sent).toContainEqual({ type: 'openPaper', paperId: 'paper' });
  c.receive({ type: 'papers', items: [] });
  expect(c.root.textContent).toContain('Not in your Library'); c.dispose();
  c.receive({ type: 'papers', items: [] }); expect(c.root.childElementCount).toBe(0);
});
