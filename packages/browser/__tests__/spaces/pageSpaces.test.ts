// Pins the browser Spaces host's checklist progress and library snapshot wiring.
import { createLoopbackTransport, type ILogger, type ProjectLibraryPort } from '@labshelf/core';
import { createPageSpaces } from '../../src/spaces';
import { memoryLibraryFs } from '../support/memoryLibraryFs';

jest.mock('../../src/spaces/watchSpaces', () => ({ watchSpaces: () => jest.fn() }));

const logger: ILogger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };

it('reports project checklist progress through the Spaces port', async () => {
  const fs = memoryLibraryFs();
  await fs.writeText('projects/thesis/labshelf.yaml', 'id: thesis\nformat: latex\nmain: main.tex\n');
  await fs.writeText('projects/thesis/main.tex', 'Text % TODO: cite this');
  await fs.writeText('projects/thesis/.labshelf/checklist.json', JSON.stringify({ items: [
    { id: 'one', text: 'Read', done: true, createdAt: '2026-10-20T10:00:00Z', doneAt: '2026-10-20T11:00:00Z' },
  ] }));
  const { ui } = createLoopbackTransport();
  const projects = { onDidChange: () => () => {}, list: async () => [{ id: 'projects/thesis', title: 'Thesis', place: 'projects' }] } as unknown as ProjectLibraryPort;
  const spaces = createPageSpaces({ fs, logger, transport: ui, workspace: () => ({}) as never, selection: {} as never, projects: () => projects, openProject: jest.fn(async () => {}) });
  expect(await spaces.port.projects()).toEqual([expect.objectContaining({ projectId: 'thesis', checklist: { done: 1, total: 2 } })]);
  spaces.dispose();
});

it('opens a fresh project entry by settings id when the host cache is empty', async () => {
  const fs = memoryLibraryFs();
  await fs.writeText('projects/folder-name/labshelf.yaml', 'id: stable-id\nformat: latex\nmain: main.tex\n');
  await fs.writeText('projects/folder-name/main.tex', 'Text');
  const openProject = jest.fn(async () => {});
  const open = jest.fn(async () => { throw new Error('Cached host list has no project'); });
  const projects = { onDidChange: () => () => {}, list: async () => [], open } as unknown as ProjectLibraryPort;
  const { ui } = createLoopbackTransport();
  const spaces = createPageSpaces({ fs, logger, transport: ui, workspace: () => ({}) as never, selection: {} as never, projects: () => projects, openProject });
  await spaces.port.openProject('stable-id');
  expect(openProject).toHaveBeenCalledWith(expect.objectContaining({ folder: 'projects/folder-name', settings: expect.objectContaining({ id: 'stable-id' }) }));
  expect(open).not.toHaveBeenCalled();
  spaces.dispose();
});
it('reads projects created after the cached host list and notifies on local edits', async () => {
  const { reportPageWrites } = await import('../../src/collab');
  const fs = reportPageWrites(memoryLibraryFs());
  const projects = { onDidChange: () => () => {}, list: async () => [], open: jest.fn() } as unknown as ProjectLibraryPort;
  const { ui } = createLoopbackTransport();
  const spaces = createPageSpaces({ fs, logger, transport: ui, workspace: () => ({}) as never, selection: {} as never, projects: () => projects, openProject: jest.fn(async () => {}) });
  expect(await spaces.port.projects()).toEqual([]);
  const changed = jest.fn();
  const off = spaces.port.onProjectsChange(changed);
  await fs.writeText('projects/later/labshelf.yaml', 'id: later\nformat: latex\nmain: main.tex\n');
  await fs.writeText('projects/later/main.tex', 'Text');
  expect(changed).toHaveBeenCalled();
  expect(await spaces.port.projects()).toEqual([expect.objectContaining({ projectId: 'later' })]);
  off(); spaces.dispose();
});

it('updates project reading progress and deadlines from current files and library', async () => {
  const fs = memoryLibraryFs();
  const settings = 'id: thesis\nformat: latex\nmain: main.tex\npapers:\n  - key: paper\ntarget:\n  deadline: 2026-11-01\n';
  await fs.writeText('projects/thesis/labshelf.yaml', settings);
  await fs.writeText('projects/thesis/main.tex', 'Text');
  const { ui, host } = createLoopbackTransport();
  const projects = { onDidChange: () => () => {}, list: async () => [] } as unknown as ProjectLibraryPort;
  const spaces = createPageSpaces({ fs, logger, transport: ui, workspace: () => ({}) as never, selection: {} as never, projects: () => projects, openProject: jest.fn(async () => {}) });
  const paper = { id: 'paper', citeKey: 'paper', title: 'Paper', path: 'papers/paper', status: 'unread' as const };
  host.post({ type: 'snapshot', snapshot: { papers: [paper], folders: [], pdfDirs: [], stats: {} } });
  expect(await spaces.port.projects()).toEqual([expect.objectContaining({ deadline: '2026-11-01', checklist: { done: 0, total: 1 } })]);
  await fs.writeText('projects/thesis/labshelf.yaml', settings.replace('2026-11-01', '2026-11-02'));
  host.post({ type: 'snapshot', snapshot: { papers: [{ ...paper, status: 'done' }], folders: [], pdfDirs: [], stats: {} } });
  expect(await spaces.port.projects()).toEqual([expect.objectContaining({ deadline: '2026-11-02', checklist: { done: 1, total: 1 } })]);
  spaces.dispose();
});
