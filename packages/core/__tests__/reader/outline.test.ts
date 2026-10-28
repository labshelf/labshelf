import {
  deriveActiveOutlineRow, deriveOutlineRows, deriveVisibleRows, type RawOutlineNode, deriveOutlineTrail, type OutlineRow,
} from "../../src/reader/outline";

describe('deriveOutlineRows', () => {
  it('lists items in document order with depth, parentId and hasChildren', () => {
    const tree: RawOutlineNode[] = [
      {
        title: 'A',
        items: [
          { title: 'A1' },
          { title: 'A2', items: [{ title: 'A2a' }] },
        ],
      },
      { title: 'B' },
    ];

    const rows = deriveOutlineRows(tree);
    expect(rows.map((r) => r.title)).toEqual(['A', 'A1', 'A2', 'A2a', 'B']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 0]);

    const [a, a1, a2, a2a, b] = rows;
    expect(a!.parentId).toBeNull();
    expect(a1!.parentId).toBe(a!.id);
    expect(a2!.parentId).toBe(a!.id);
    expect(a2a!.parentId).toBe(a2!.id);
    expect(b!.parentId).toBeNull();

    expect(a!.hasChildren).toBe(true);
    expect(a1!.hasChildren).toBe(false);
    expect(a2!.hasChildren).toBe(true);
    expect(a2a!.hasChildren).toBe(false);
    expect(b!.hasChildren).toBe(false);
  });

  it('normalises whitespace in titles', () => {
    const rows = deriveOutlineRows([{ title: '  Foo\n\tBar   Baz  ' }]);
    expect(rows[0]!.title).toBe('Foo Bar Baz');
  });

  it('falls back to "Untitled" for a blank or missing title', () => {
    const rows = deriveOutlineRows([
      { title: '' },
      { title: '   \n  ' },
      { title: undefined as unknown as string },
    ]);
    expect(rows.map((r) => r.title)).toEqual(['Untitled', 'Untitled', 'Untitled']);
  });

  it('returns an empty array for null or undefined input', () => {
    expect(deriveOutlineRows(null)).toEqual([]);
    expect(deriveOutlineRows(undefined)).toEqual([]);
  });

  it('stops descending beyond the depth cap', () => {
    // Build a 14-level-deep chain of single-child nodes.
    let leaf: RawOutlineNode = { title: 'L13' };
    for (let level = 12; level >= 0; level--) {
      leaf = { title: `L${level}`, items: [leaf] };
    }

    const rows = deriveOutlineRows([leaf]);
    // Only depths 0..11 (12 levels) are emitted; deeper nodes are dropped.
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.title)).toEqual(Array.from({ length: 12 }, (_, i) => `L${i}`));
    // The last emitted row's own children were cut off, even though the source node had one.
    expect(rows[11]!.hasChildren).toBe(false);
  });
});

describe('deriveVisibleRows', () => {
  const tree: RawOutlineNode[] = [
    {
      title: 'A',
      items: [
        { title: 'A1' },
        { title: 'A2', items: [{ title: 'A2a' }] },
      ],
    },
    { title: 'B' },
  ];
  const rows = deriveOutlineRows(tree);
  const idOf = (title: string): number => rows.find((r) => r.title === title)!.id;

  it('hides all descendants of a collapsed node, including grandchildren, but keeps siblings', () => {
    const collapsed = new Set([idOf('A2')]);
    const visible = deriveVisibleRows(rows, collapsed).map((r) => r.title);

    expect(visible).toEqual(['A', 'A1', 'A2', 'B']);
    expect(visible).not.toContain('A2a');
  });

  it('shows every row when nothing is collapsed', () => {
    expect(deriveVisibleRows(rows, new Set()).map((r) => r.title)).toEqual(['A', 'A1', 'A2', 'A2a', 'B']);
  });
});

describe('deriveActiveOutlineRow', () => {
  it('returns the last entry starting at or before the current page', () => {
    expect(deriveActiveOutlineRow([1, 5, 10], 7)).toBe(1);
  });

  it('ignores null pages', () => {
    expect(deriveActiveOutlineRow([null, 2, null], 5)).toBe(1);
  });

  it('returns -1 when no entry qualifies', () => {
    expect(deriveActiveOutlineRow([10, 20], 1)).toBe(-1);
    expect(deriveActiveOutlineRow([null, null], 5)).toBe(-1);
  });

  it('prefers the later row on a tie', () => {
    expect(deriveActiveOutlineRow([1, null, 3, 3, 5], 4)).toBe(3);
  });
});

function row(id: number, parentId: number | null, depth: number, title: string): OutlineRow {
  return { id, parentId, depth, title, dest: null, url: null, hasChildren: false, bold: false };
}

const rows = [
  row(0, null, 0, "Intro"),
  row(1, 0, 1, "Background"),
  row(2, null, 0, "Methods"),
  row(3, 2, 1, "Setup"),
  row(4, 3, 2, "Details"),
];
const pages = [2, 3, 5, 6, 7];
const titles = (page: number, p: (number | null)[] = pages) => deriveOutlineTrail(rows, p, page).map((r) => r.title);

describe("deriveOutlineTrail", () => {
  it("is empty before the first entry", () => {
    expect(titles(1)).toEqual([]);
  });

  it("is empty without rows", () => {
    expect(deriveOutlineTrail([], [], 4)).toEqual([]);
  });

  it("gives the section alone for a top-level entry", () => {
    expect(titles(5)).toEqual(["Methods"]);
  });

  it("gives section then subsection", () => {
    expect(titles(3)).toEqual(["Intro", "Background"]);
    expect(titles(6)).toEqual(["Methods", "Setup"]);
  });

  it("keeps the last entry's trail for pages past it", () => {
    expect(titles(99)).toEqual(["Methods", "Setup"]);
  });

  it("stops at two levels under a deeper entry", () => {
    expect(titles(7)).toEqual(["Methods", "Setup"]);
  });

  it("skips entries whose page did not resolve", () => {
    expect(titles(6, [2, 3, 5, null, null])).toEqual(["Methods"]);
    expect(titles(4, [null, null, 5, 6, 7])).toEqual([]);
  });
});
