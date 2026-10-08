import { ROOT_LABEL } from '@labshelf/core';
import type { PaperRecord } from '@labshelf/core';
import { buildListState, rootNode } from '../../../src/ui/library/listState';

const ROOT = '/lib/papers';

function paper(id: string, dir: string): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: id, authors: [], status: 'unread' } as unknown as PaperRecord;
}

describe('buildListState', () => {
  const papers = [paper('p1', `${ROOT}/A`), paper('p2', `${ROOT}/A/B`), paper('p3', `${ROOT}/Z`), paper('p4', ROOT)];

  it('opens a non-leaf folder with its own papers, nested papers, and counted subfolders', () => {
    const folder = { label: 'A', dirPath: `${ROOT}/A` };
    const state = buildListState(papers, folder, ROOT, [{ label: 'B', dirPath: `${ROOT}/A/B` }], '/');

    expect(state.type).toBe('state');
    expect(state.papers.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(state.papers.map((p) => p.relFolder)).toEqual(['', 'B']);
    expect(state.papers[1]?.folderPath).toBe(`${ROOT}/A/B`);
    expect(state.subfolders).toEqual([{ label: 'B', dirPath: `${ROOT}/A/B`, count: 1 }]);
  });

  it('maps the breadcrumb onto dirPath, marking only the root', () => {
    const state = buildListState(papers, { label: 'B', dirPath: `${ROOT}/A/B` }, ROOT, [], '/');
    expect(state.breadcrumb).toEqual([
      { label: ROOT_LABEL, dirPath: ROOT, isRoot: true },
      { label: 'A', dirPath: `${ROOT}/A` },
      { label: 'B', dirPath: `${ROOT}/A/B` },
    ]);
  });

  it('shows the whole library, including unfiled papers, at the root', () => {
    const state = buildListState(papers, rootNode(ROOT), ROOT, [], '/');
    expect(state.papers).toHaveLength(4);
    expect(state.papers.find((p) => p.id === 'p4')?.relFolder).toBe('');
    expect(state.papers.find((p) => p.id === 'p2')?.relFolder).toBe('A / B');
  });

  it('carries hasPdf through to each ListPaper so the row can render it honestly', () => {
    const withPdf = { ...paper('p1', `${ROOT}/A`), hasPdf: true } as unknown as PaperRecord;
    const without = { ...paper('p2', `${ROOT}/A`), hasPdf: false } as unknown as PaperRecord;
    const state = buildListState([withPdf, without], { label: 'A', dirPath: `${ROOT}/A` }, ROOT, [], '/');
    const byId = new Map(state.papers.map((p) => [p.id, p]));
    expect(byId.get('p1')!.hasPdf).toBe(true);
    expect(byId.get('p2')!.hasPdf).toBe(false);
  });

  it('lists every paper in the detail pane library with its folder', () => {
    const state = buildListState(papers, rootNode(ROOT), ROOT, [], '/');
    expect(state.library.map((p) => [p.id, p.folderPath])).toEqual([
      ['p1', `${ROOT}/A`], ['p2', `${ROOT}/A/B`], ['p3', `${ROOT}/Z`], ['p4', ROOT],
    ]);
  });
});
