/** Checks Space paper reference actions through the transport.
 * @jest-environment jsdom
 */
import { mountSpacePapers } from '../../../../src/spaces/dom/papers/index.js';
import type { SpaceSnapshot } from '../../../../src/spaces/dom/spaceOverview/index.js';
import type { HostToSpaces, SpacesToHost, SpacesTransport } from '../../../../src/spaces/protocol/index.js';
function setup(folder?: string) {
  const data: SpaceSnapshot = { type: 'space', space: { id: 's', name: 'Space', folders: [{ id: 'f', name: 'Folder', extra: {} }],
    papers: [{ id: 'p', focus: false, extra: {} }, { id: 'gone', focus: false, extra: {} }], projects: [], dates: [], extra: {},
    invalid: { folders: [], papers: [], projects: [], dates: [] } }, overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [],
    papers: { folders: [{ id: 'f', name: 'Folder', folders: [], papers: [] }], papers: [
      { id: 'p', missing: false, title: 'Paper', authors: ['Author'], year: 2026, status: 'reading' }, { id: 'gone', missing: true }] } };
  const sent: SpacesToHost[] = []; const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: m => sent.push(m), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const root = document.createElement('div'); document.body.append(root);
  const body = mountSpacePapers(root, { data, end, readOnly: false, ...(folder ? { folder } : {}) });
  return { data, sent, body, root, receive: (m: HostToSpaces) => [...listeners].forEach(fn => fn(m)) };
}
function click(text: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
  if (!button) throw new Error(`Missing ${text}`); button.click();
}
beforeEach(() => document.body.replaceChildren());
test('selects, opens, focuses and moves a reference', () => {
  const c = setup(); click('Paper');
  c.root.querySelector('.pp-title')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  c.root.querySelector('.pp-title')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  click('In focus'); click('Move to folder'); click('Folder', document.querySelector('[role="menu"]')!);
  expect(c.sent).toEqual([{ type: 'selectPaper', paperId: 'p' }, { type: 'openPaper', paperId: 'p' }, { type: 'openPaper', paperId: 'p' },
    { type: 'setFocus', id: 's', paperId: 'p', focus: true }, { type: 'moveReference', id: 's', paperId: 'p', folder: 'f' }]); c.body.dispose();
});
test('missing references have Remove only and confirmation retains Library paper', () => {
  const c = setup(); const row = c.root.querySelector('[data-paper-id="gone"]')!;
  expect(row.textContent).toContain('Not in your Library'); expect(row.querySelectorAll('button')).toHaveLength(1);
  click('Remove', row); click('Remove', document.querySelector('[role="dialog"]')!);
  expect(c.sent).toEqual([{ type: 'removePaper', id: 's', paperId: 'gone' }]); c.body.dispose();
});
test('adds multiple Library papers to the sidebar-selected folder', () => {
  const c = setup('f'); click('Add papers'); expect(c.sent).toContainEqual({ type: 'listPapers' });
  c.receive({ type: 'papers', items: ['a', 'b'].map(id => ({ id, missing: false, title: id, authors: [], status: 'unread' })) });
  document.querySelectorAll<HTMLInputElement>('[name="paperIds"]').forEach(input => input.click()); click('Add');
  expect(c.sent).toContainEqual({ type: 'addPapers', id: 's', paperIds: ['a', 'b'], folder: 'f' }); c.body.dispose();
});
test('creates and renames folders, confirms deleting with references moved up', async () => {
  const c = setup('f'); click('New folder');
  let input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!; input.value = 'Child'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await Promise.resolve(); expect(c.sent).toContainEqual({ type: 'createFolder', id: 's', name: 'Child', parent: 'f' });
  click('Rename folder'); input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!; input.value = 'Renamed'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await Promise.resolve(); expect(c.sent).toContainEqual({ type: 'renameFolder', id: 's', folderId: 'f', name: 'Renamed' });
  click('Delete folder'); expect(document.querySelector('[role="dialog"]')!.textContent).toContain('move'); click('Delete');
  expect(c.sent).toContainEqual({ type: 'deleteFolder', id: 's', folderId: 'f' }); c.body.dispose();
});
test('blocks writes after a read-only snapshot and closes picker on dispose', () => {
  const c = setup(); click('Add papers'); c.body.update({ ...c.data, readOnlyReason: 'Unsupported version' });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); click('Add papers'); click('In focus'); click('Paper');
  expect(c.sent).toEqual([{ type: 'listPapers' }, { type: 'selectPaper', paperId: 'p' }]); c.body.dispose();
});
test('accepts same-Space reference drops and rejects malformed or foreign drops', () => {
  const c = setup();
  const target = c.root.querySelector('[aria-label="Folder"]')!;
  const drop = (payload: string) => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { getData: () => payload } }); target.dispatchEvent(event);
  };
  drop('{'); drop(JSON.stringify({ spaceId: 'elsewhere', paperId: 'p' })); drop(JSON.stringify({ spaceId: 's', paperId: 'unknown' }));
  expect(c.sent).toEqual([]); drop(JSON.stringify({ spaceId: 's', paperId: 'p' }));
  expect(c.sent).toEqual([{ type: 'moveReference', id: 's', paperId: 'p', folder: 'f' }]); c.body.dispose();
});
test('unmarks focus and stops picker subscriptions and late draft actions on dispose', async () => {
  const c = setup(); c.body.update({ ...c.data, space: { ...c.data.space, papers: c.data.space.papers.map(p => ({ ...p, focus: true })) } });
  expect(c.root.querySelector('[aria-pressed="true"]')).not.toBeNull(); click('In focus');
  expect(c.sent).toContainEqual({ type: 'setFocus', id: 's', paperId: 'p', focus: false });
  click('Add papers'); c.body.dispose();
  c.receive({ type: 'papers', items: [{ id: 'extra', missing: false, title: 'Extra', authors: [], status: 'unread' }] });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(c.root.textContent).toBe('');
  await Promise.resolve(); expect(c.sent.some(m => m.type === 'addPapers')).toBe(false);
});
