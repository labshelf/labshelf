/**
 * Tests the generated Tabler icon library: its integrity (size, categories, order, bodies) and the find, search and render helpers.
 */
import {
  TABLER_CATEGORIES,
  TABLER_ICONS,
  findTablerIcon,
  renderTablerIcon,
  searchTablerIcons,
} from "../../../src/ui/icons";

describe("TABLER_ICONS", () => {
  it("holds between 30 and 50 icons", () => {
    expect(TABLER_ICONS.length).toBeGreaterThanOrEqual(30);
    expect(TABLER_ICONS.length).toBeLessThanOrEqual(50);
  });

  it("is sorted by name without duplicates", () => {
    const names = TABLER_ICONS.map((icon) => icon.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
  });

  it("uses every category and only known ones", () => {
    const used = new Set(TABLER_ICONS.map((icon) => icon.category));
    for (const category of TABLER_CATEGORIES) expect(used.has(category)).toBe(true);
    for (const category of used) expect(TABLER_CATEGORIES).toContain(category);
  });

  it("gives every icon a label and an inner SVG body", () => {
    for (const icon of TABLER_ICONS) {
      expect(icon.label.trim()).not.toBe("");
      expect(icon.body).toMatch(/^<(path|circle|rect|line|polyline|polygon|ellipse)\b/);
      expect(icon.body).not.toContain("<svg");
    }
  });

  it("includes the generic icons", () => {
    for (const name of ["folder", "file", "book", "notebook", "star", "bookmark"]) {
      expect(findTablerIcon(name)?.category).toBe("General");
    }
  });
});

describe("searchTablerIcons", () => {
  it("finds a DNA icon", () => {
    expect(searchTablerIcons("dna").map((icon) => icon.name)).toContain("dna");
  });

  it("matches tags case-insensitively", () => {
    expect(searchTablerIcons("GENETICS").map((icon) => icon.name)).toContain("dna");
  });

  it("lists only the category's icons for an empty query", () => {
    const chemistry = searchTablerIcons("", "Chemistry");
    expect(chemistry.length).toBeGreaterThan(0);
    for (const icon of chemistry) expect(icon.category).toBe("Chemistry");
  });

  it("returns every icon for an empty query without a category", () => {
    expect(searchTablerIcons("  ")).toHaveLength(TABLER_ICONS.length);
  });

  it("returns nothing for an unmatched query", () => {
    expect(searchTablerIcons("zzzz-no-such-icon")).toEqual([]);
  });
});

describe("findTablerIcon and renderTablerIcon", () => {
  it("finds an icon by name and misses unknown names", () => {
    expect(findTablerIcon("dna")?.name).toBe("dna");
    expect(findTablerIcon("unknown")).toBeUndefined();
  });

  it("returns null for an unknown icon", () => {
    expect(renderTablerIcon("unknown")).toBeNull();
  });

  it("renders a full accessible stroke svg like the app icons", () => {
    const svg = renderTablerIcon("dna");
    expect(svg).not.toBeNull();
    expect(svg!.startsWith("<svg ")).toBe(true);
    expect(svg!.endsWith("</svg>")).toBe(true);
    const root = svg!.slice(0, svg!.indexOf(">"));
    expect(root).toContain('viewBox="0 0 24 24"');
    expect(root).toContain('stroke="currentColor"');
    expect(root).toContain('stroke-width="1.5"');
    expect(root).toContain('fill="none"');
    expect(root).toContain('aria-hidden="true"');
    expect(root).toContain('focusable="false"');
    expect(root).not.toMatch(/\swidth=|\sheight=/);
    expect(svg).toContain(findTablerIcon("dna")!.body);
  });
});
