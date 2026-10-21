/** Checks Space interactions across the page transport.
 * @jest-environment jsdom
 */
import { mountSpace } from '../../../../src/spaces/dom/frame/index.js';
import type { HostToSpaces, SpacesToHost, SpacesTransport } from '../../../../src/spaces/protocol/index.js';

function channel() {
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const transport: SpacesTransport = { post: m => sent.push(m), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  return { sent, transport, receive: (m: HostToSpaces) => [...listeners].forEach(fn => fn(m)) };
}
function snapshot(): Extract<HostToSpaces, { type: 'space' }> {
  return {
    type: 'space',
    space: { id: 'research', name: 'Research', purpose: 'Study', papers: [], folders: [], projects: [],
      dates: [{ id: 'task1', kind: 'task', title: 'Read', date: '2026-10-20', done: false, extra: {} }],
      extra: {}, invalid: { folders: [], papers: [], dates: [], projects: [] } },
    overview: { timeline: [{ id: 'task1', kind: 'task', title: 'Read', date: '2026-10-20', when: 'today', daysAway: 0, overdue: false, done: false }], projects: [], focus: [] },
    papers: { papers: [], folders: [] }, glossary: { terms: [] }, projects: [{ projectId: 'p', title: 'Thesis', available: true }],
  };
}
const click = (text: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent === text);
  if (!b) throw new Error(`Missing button ${text}`);
  b.click();
};
const field = (name: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
beforeEach(() => { document.body.replaceChildren(); });

test('reports tabs, task completion, calendar export and stops listening on dispose', () => {
  const c = channel(); const root = document.createElement('div'); document.body.append(root);
  const tabs: string[] = [];
  const dispose = mountSpace(root, c.transport, { id: 'research', tab: 'overview', onTab: tab => tabs.push(tab) });
  expect(c.sent).toEqual([{ type: 'ready', view: 'space', id: 'research' }]);
  c.receive(snapshot());
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  click('Export .ics'); click('Papers');
  expect(c.sent).toContainEqual({ type: 'setDone', id: 'research', dateId: 'task1', done: true });
  expect(c.sent).toContainEqual({ type: 'exportIcs', id: 'research' });
  expect(tabs).toEqual(['papers']);
  expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Papers');
  dispose(); c.receive(snapshot()); expect(root.childElementCount).toBe(0);
});

test.each(['task', 'deadline', 'read', 'project'])('adds a %s with only its kind fields', kind => {
  const c = channel(); const root = document.createElement('div'); document.body.append(root);
  mountSpace(root, c.transport, { id: 'research', tab: 'overview' }); c.receive(snapshot());
  click('Add date'); field('kind', kind); field('title', 'Finish reading'); field('date', '2026-11-01');
  if (kind === 'read') {
    c.receive({ type: 'papers', items: [{ id: 'paper', title: 'A paper', missing: false, status: 'unread', authors: [] }] });
    document.querySelector<HTMLInputElement>('[name="paperIds"]')!.click();
  }
  if (kind === 'project') field('projectId', 'p');
  click('Save');
  const extra = kind === 'task' ? { done: false } : kind === 'read' ? { paperIds: ['paper'] } : kind === 'project' ? { projectId: 'p' } : {};
  expect(c.sent).toContainEqual({ type: 'addDate', id: 'research', date: { kind, title: 'Finish reading', date: '2026-11-01', ...extra } });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test('keeps a read-only Space navigable while blocking writes', () => {
  const c = channel(); const root = document.createElement('div'); document.body.append(root);
  mountSpace(root, c.transport, { id: 'research', tab: 'overview' }); c.receive({ ...snapshot(), readOnlyReason: 'Unsupported version' });
  expect(root.textContent).toContain('Unsupported version');
  click('Add date'); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  click('Glossary'); expect(root.querySelector('[aria-selected="true"]')?.textContent).toBe('Glossary');
});


function mount(data = snapshot()) {
  const c = channel();
  const root = document.createElement('div'); document.body.append(root);
  const dispose = mountSpace(root, c.transport, { id: 'research', tab: 'overview' });
  c.receive(data);
  return { ...c, root, dispose };
}

function editHeader(label: string, value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input;
}

test('edits the header with trimmed values and removes an empty purpose', () => {
  const c = mount();
  editHeader('Space name', '  Research notes  ');
  editHeader('Add a purpose', '  Study together  ');
  editHeader('Add a purpose', '  ');
  expect(c.sent).toContainEqual({ type: 'renameSpace', id: 'research', name: 'Research notes' });
  expect(c.sent).toContainEqual({ type: 'setPurpose', id: 'research', purpose: 'Study together' });
  expect(c.sent).toContainEqual({ type: 'setPurpose', id: 'research' });
  const count = c.sent.length;
  editHeader('Space name', ' ');
  expect(c.sent).toHaveLength(count);
  c.dispose();
});

test('updates a date draft without losing task completion and removes its id', () => {
  const data = snapshot();
  const task = data.space.dates[0]!;
  if (task.kind === 'task') data.space = { ...data.space, dates: [{ ...task, done: true }] };
  const c = mount(data);
  click('Edit');
  expect(document.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe('Read');
  field('title', 'Finish'); field('date', '2026-11-02'); click('Save');
  expect(c.sent).toContainEqual({ type: 'updateDate', id: 'research', dateId: 'task1',
    date: { kind: 'task', title: 'Finish', date: '2026-11-02', done: true } });
  click('Remove');
  expect(c.sent).toContainEqual({ type: 'removeDate', id: 'research', dateId: 'task1' });
  c.dispose();
});

test('keeps invalid date drafts open and cancels without a mutation', () => {
  const c = mount();
  click('Add date'); field('title', '   '); field('date', '2026-11-02');
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Enter a title');
  expect(c.sent.some(m => m.type === 'addDate')).toBe(false);
  click('Cancel');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  c.receive({ ...snapshot(), space: { ...snapshot().space, name: 'Still listening' } });
  expect(document.querySelector<HTMLInputElement>('[aria-label="Space name"]')?.value).toBe('Still listening');
  c.dispose();
});

test('preserves missing papers while editing a reading goal', () => {
  const data = snapshot();
  data.space = { ...data.space, dates: [{ id: 'task1', kind: 'read', title: 'Read', date: '2026-10-20', paperIds: ['missing'], extra: {} }] };
  const c = mount(data);
  click('Edit');
  c.receive({ type: 'papers', items: [] });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('missing — Not in your Library');
  expect(document.querySelector<HTMLInputElement>('[name="paperIds"]')?.checked).toBe(true);
  click('Save');
  expect(c.sent).toContainEqual({ type: 'updateDate', id: 'research', dateId: 'task1',
    date: { kind: 'read', title: 'Read', date: '2026-10-20', paperIds: ['missing'] } });
  c.dispose();
});

test('links only available unlinked projects and permits unlinking missing projects', async () => {
  Element.prototype.scrollIntoView = () => {};
  const data = snapshot();
  data.space = { ...data.space, projects: ['linked'] };
  data.projects = [{ projectId: 'linked', title: 'Linked', available: true },
    { projectId: 'missing', title: 'Missing', available: false }, { projectId: 'pick', title: 'Available', available: true }];
  data.overview = { ...data.overview, projects: [{ projectId: 'missing', title: 'Missing', available: false }] };
  const c = mount(data);
  const missing = [...c.root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Missing')!;
  expect(missing.disabled).toBe(true);
  expect(c.root.textContent).toContain('Not on this device');
  click('Unlink');
  expect(c.sent).toContainEqual({ type: 'unlinkProject', id: 'research', projectId: 'missing' });
  click('Link');
  expect([...document.querySelectorAll('[role="option"]')].map(o => o.textContent)).toEqual(['Available']);
  (document.querySelector('[role="option"]') as HTMLElement).click();
  await Promise.resolve();
  expect(c.sent).toContainEqual({ type: 'linkProject', id: 'research', projectId: 'pick' });
  c.dispose();
});

test('opens focus papers and permits removing a missing reference', () => {
  const data = snapshot();
  data.overview = { ...data.overview, timeline: [], focus: [
    { id: 'present', missing: false, title: 'Paper title', authors: ['Author'], status: 'reading' },
    { id: 'missing', missing: true }] };
  const c = mount(data);
  click('Paper title'); click('Remove');
  expect(c.sent).toContainEqual({ type: 'openPaper', paperId: 'present' });
  expect(c.sent).toContainEqual({ type: 'removePaper', id: 'research', paperId: 'missing' });
  expect(c.root.textContent).toContain('missing — Not in your Library');
  c.dispose();
});

test('ignores snapshots for another Space and closes the date dialog on navigation', () => {
  const c = mount();
  c.receive({ ...snapshot(), space: { ...snapshot().space, id: 'other', name: 'Other' } });
  expect(document.querySelector<HTMLInputElement>('[aria-label="Space name"]')?.value).toBe('Research');
  click('Add date'); click('Papers');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(c.sent.some(m => m.type === 'addDate')).toBe(false);
  c.dispose();
});

test('places Today between past and future dates and excludes project deadline edits', () => {
  const data = snapshot();
  data.overview = { ...data.overview, timeline: [
    { id: 'past', kind: 'deadline', title: 'Past', date: '2026-10-19', when: 'past', daysAway: -1, overdue: false },
    { id: 'project:p', kind: 'project', title: 'Project', date: '2026-10-21', when: 'future', daysAway: 1, overdue: false, fromProject: true }] };
  const c = mount(data);
  const rows = [...c.root.querySelectorAll('.tl-list > li')];
  expect(rows).toHaveLength(3);
  expect(rows[0]?.textContent).toContain('Past');
  expect(rows[1]?.textContent).toBe('Today');
  expect(rows[2]?.textContent).toContain('Project deadline');
  expect(rows[2]?.querySelector('button')).toBeNull();
  c.dispose();
});

test('dismisses the project picker on navigation without linking a project', async () => {
  Element.prototype.scrollIntoView = () => {};
  const c = mount();
  click('Link');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  click('Papers');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await Promise.resolve();
  expect(c.sent.some(m => m.type === 'linkProject')).toBe(false);
  c.dispose();
});

test('blocks header and reference mutations while keeping read-only navigation available', () => {
  const data = snapshot();
  data.readOnlyReason = 'Unsupported version';
  data.overview = { ...data.overview, timeline: [], projects: [{ projectId: 'p', title: 'Thesis', available: true }],
    focus: [{ id: 'present', missing: false, title: 'Paper', status: 'unread', authors: [] }, { id: 'missing', missing: true }] };
  const c = mount(data);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Space name"]')?.disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Add a purpose"]')?.disabled).toBe(true);
  for (const label of ['Link', 'Unlink', 'Remove', 'Add date']) click(label);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  click('Thesis'); click('Paper'); click('Export .ics');
  expect(c.sent).toEqual([{ type: 'ready', view: 'space', id: 'research' }, { type: 'openProject', projectId: 'p' },
    { type: 'openPaper', paperId: 'present' }, { type: 'exportIcs', id: 'research' }]);
  c.dispose();
});

test('keeps an unfinished date draft across background Space snapshots', () => {
  const c = mount();
  click('Add date'); field('title', 'Unfinished draft'); field('date', '2026-11-02');
  c.receive({ ...snapshot(), space: { ...snapshot().space, name: 'Updated externally' } });
  expect(document.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe('Unfinished draft');
  click('Save');
  expect(c.sent).toContainEqual({ type: 'addDate', id: 'research', date: { kind: 'task', title: 'Unfinished draft', date: '2026-11-02', done: false } });
  c.dispose();
});

test('preserves a focused header draft during background updates', () => {
  const c = mount();
  const name = c.root.querySelector<HTMLInputElement>('[aria-label="Space name"]')!;
  name.focus(); name.value = 'Typing a name';
  c.receive({ ...snapshot(), space: { ...snapshot().space, name: 'External name' } });
  expect(c.root.querySelector<HTMLInputElement>('[aria-label="Space name"]')?.value).toBe('Typing a name');
  name.dispatchEvent(new Event('change', { bubbles: true }));
  expect(c.sent).toContainEqual({ type: 'renameSpace', id: 'research', name: 'Typing a name' });
  c.dispose();
});
