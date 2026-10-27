import type { CitationMap } from "@labshelf/core";
import { createCitationMapView } from "../../../src/libraryUi/citationMap/index";

const papers = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: `Paper ${id}`, extra: 1 }));
const work = (citedBy: string[]) => ({ workId: 'W1', title: 'Missing', citedBy }) as unknown as CitationMap['missing'][number];

describe('citationMapView', () => {
  it('keeps the papers in links and in missing works, as id and title', () => {
    const map: CitationMap = { links: [{ from: 'a', to: 'b' }], missing: [work(['c'])], unresolved: [] };
    expect(createCitationMapView(map, papers).papers).toEqual([
      { id: 'a', title: 'Paper a' }, { id: 'b', title: 'Paper b' }, { id: 'c', title: 'Paper c' },
    ]);
  });

  it('passes links and missing works through and drops unresolved ids', () => {
    const map: CitationMap = { links: [{ from: 'a', to: 'b' }], missing: [work(['a'])], unresolved: ['d'] };
    const view = createCitationMapView(map, papers);
    expect(view.links).toBe(map.links);
    expect(view.missing).toBe(map.missing);
    expect(view).not.toHaveProperty('unresolved');
  });

  it('names no papers for an empty map', () => {
    expect(createCitationMapView({ links: [], missing: [], unresolved: [] }, papers).papers).toEqual([]);
  });
});
