/** Checks the Space header's Share control and the Download controls of the papers tab through the transport.
 * @jest-environment jsdom
 */
import { mountSpace } from '../../../src/spaces/dom/mountSpace.js';
import { mountSpacePapers } from '../../../src/spaces/dom/mountSpacePapers.js';
import type { SpaceSnapshot } from '../../../src/spaces/dom/mountOverview.js';
import type { HostToSpaces, SpacesToHost, SpacesTransport } from '../../../src/spaces/spacesProtocol.js';

const remote = { title: 'Remote paper', authors: ['Ana', 'Bo'], year: 2024, downloadable: true, hasPdf: true };
function snapshot(extra: Partial<SpaceSnapshot> = {}): SpaceSnapshot {
  return { type: 'space', space: { id: 's', name: 'Space', folders: [{ id: 'f', name: 'Folder', extra: {} }, { id: 'g', name: 'Plain', extra: {} }],
    papers: [{ id: 'r', folder: 'f', focus: false, extra: {} }, { id: 'bare', focus: false, extra: {} }], projects: [], dates: [], extra: {},
    invalid: { folders: [], papers: [], projects: [], dates: [] } }, overview: { desk: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [],
    papers: { folders: [{ id: 'f', name: 'Folder', folders: [], papers: [{ id: 'r', missing: true, remote }] }, { id: 'g', name: 'Plain', folders: [], papers: [] }],
      papers: [{ id: 'bare', missing: true }] }, ...extra };
}
function transport() {
  const sent: SpacesToHost[] = []; const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: m => sent.push(m), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  return { sent, end, receive: (m: HostToSpaces) => [...listeners].forEach(fn => fn(m)) };
}
function mountPage(data: SpaceSnapshot) {
  const t = transport(); const root = document.createElement('div'); document.body.append(root);
  const dispose = mountSpace(root, t.end, { id: 's' }); t.receive(data);
  return { ...t, root, dispose };
}
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => document.body.replaceChildren());

describe('Space header share control', () => {
  it('keeps the planned notice where the host cannot share', () => {
    const c = mountPage(snapshot());
    button(c.root, 'Share')!.click();
    expect(c.sent.filter(m => m.type === 'shareSpace')).toEqual([]);
    c.dispose();
  });

  it('posts shareSpace from Share when the host can share', () => {
    const c = mountPage(snapshot({ canShare: true, share: { shared: false, connected: false } }));
    button(c.root, 'Share')!.click();
    expect(c.sent).toContainEqual({ type: 'shareSpace', id: 's' });
    c.dispose();
  });

  it('shows Shared with its connection state in the title', () => {
    const c = mountPage(snapshot({ canShare: true, share: { shared: true, connected: false, problem: 'Relay unreachable' } }));
    expect(button(c.root, 'Share')).toBeUndefined();
    expect(button(c.root, 'Shared')!.title).toBe('Relay unreachable');
    c.receive(snapshot({ canShare: true, share: { shared: true, connected: false } }));
    expect(button(c.root, 'Shared')!.title).toBe('Not connected');
    c.dispose();
  });

  it('posts leaveSpace only after the confirmation', async () => {
    const c = mountPage(snapshot({ canShare: true, share: { shared: true, connected: true } }));
    button(c.root, 'Shared')!.click();
    button(document.body, 'Stop sharing on this device')!.click();
    await flush();
    button(document.body, 'Cancel')!.click();
    await flush();
    expect(c.sent.filter(m => m.type === 'leaveSpace')).toEqual([]);
    button(c.root, 'Shared')!.click();
    button(document.body, 'Stop sharing on this device')!.click();
    await flush();
    button(document.querySelector('[role="alertdialog"]')!, 'Stop sharing')!.click();
    await flush();
    expect(c.sent.filter(m => m.type === 'leaveSpace')).toEqual([{ type: 'leaveSpace', id: 's' }]);
    c.dispose();
  });
});

describe('papers tab download controls', () => {
  function papers(extra: Partial<SpaceSnapshot> = {}, folder?: string) {
    const t = transport(); const root = document.createElement('div'); document.body.append(root);
    const body = mountSpacePapers(root, { data: snapshot(extra), end: t.end, readOnly: false, ...(folder ? { folder } : {}) });
    return { ...t, root, body };
  }

  it('shows a missing paper from its info with a Download', () => {
    const c = papers({ canDownload: true });
    const row = c.root.querySelector('[data-paper-id="r"]')!;
    expect(row.textContent).toContain('Remote paper');
    expect(row.textContent).toContain('Ana · Bo · 2024');
    expect(row.textContent).not.toContain('— Not in your Library');
    button(row, 'Download')!.click();
    expect(c.sent).toEqual([{ type: 'downloadSpacePapers', id: 's', what: { kind: 'paper', paperId: 'r' } }]);
    c.body.dispose();
  });

  it('gives Download all when a downloadable missing paper exists, and not to a bare missing paper', () => {
    const c = papers({ canDownload: true });
    expect(button(c.root.querySelector('[data-paper-id="bare"]')!, 'Download')).toBeUndefined();
    button(c.root, 'Download all')!.click();
    expect(c.sent).toEqual([{ type: 'downloadSpacePapers', id: 's', what: { kind: 'space' } }]);
    c.body.dispose();
  });

  it('gives Download folder to a folder that holds one, not to one that does not', () => {
    const c = papers({ canDownload: true }, 'f');
    button(c.root, 'Download folder')!.click();
    expect(c.sent).toEqual([{ type: 'downloadSpacePapers', id: 's', what: { kind: 'folder', folderId: 'f' } }]);
    c.body.dispose();
    document.body.replaceChildren();
    const plain = papers({ canDownload: true }, 'g');
    expect(button(plain.root, 'Download folder')).toBeUndefined();
    plain.body.dispose();
  });

  it('hides every download control where the host cannot download', () => {
    const c = papers({}, 'f');
    expect(button(c.root, 'Download')).toBeUndefined();
    expect(button(c.root, 'Download all')).toBeUndefined();
    expect(button(c.root, 'Download folder')).toBeUndefined();
    expect(c.root.querySelector('[data-paper-id="r"]')!.textContent).toContain('Remote paper');
    c.body.dispose();
  });
});
