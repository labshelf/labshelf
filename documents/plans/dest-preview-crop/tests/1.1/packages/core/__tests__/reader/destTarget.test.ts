import {
  classifyDestName,
  classifyLinkText,
  deriveStatementRegion,
  findFloatCaptionNear,
} from "../../src/reader/destTarget";
import type { PageLayout } from "../../src/reader/destTarget";
import type { TextLine } from "../../src/reader/textLines";

const W = 612;
const H = 792;
const SPLIT = 306;
const single: PageLayout = { width: W, height: H, columnSplit: null };
const twoCol: PageLayout = { width: W, height: H, columnSplit: SPLIT };

const line = (text: string, y: number, over: Partial<TextLine> = {}): TextLine =>
  ({ text, x: 72, xEnd: 540, y, height: 11, column: 0, ...over });
const body = (fromY: number, count: number, over: Partial<TextLine> = {}): TextLine[] =>
  Array.from({ length: count }, (_, i) => line("Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod", fromY - i * 15, over));

const THM = "Theorem 2.1. Let f be continuous on a closed interval and let";
const CONT = "then f attains every value between its endpoint values on it";

const LEFT = { x: 72, xEnd: 290, column: 0 };
const RIGHT = { x: 322, xEnd: 540, column: 1 };

describe("classifyDestName", () => {
  it("1.1a maps theorem.2.1 and lemma.3 to a statement", () => {
    expect(classifyDestName("theorem.2.1")).toEqual({ kind: "statement" });
    expect(classifyDestName("lemma.3")).toEqual({ kind: "statement" });
  });

  it("1.1a maps abbreviated and upper-case statement names, and colon separators, to a statement", () => {
    expect(classifyDestName("thm.1")).toEqual({ kind: "statement" });
    expect(classifyDestName("defn.4")).toEqual({ kind: "statement" });
    expect(classifyDestName("Theorem.2.1")).toEqual({ kind: "statement" });
    expect(classifyDestName("proposition:main")).toEqual({ kind: "statement" });
  });

  it("1.1a maps figure.3 to a figure float with label 3", () => {
    expect(classifyDestName("figure.3")).toEqual({ kind: "float", floatKind: "figure", label: "3" });
  });

  it("1.1a maps equation.2.5 to an equation float with label 2.5", () => {
    expect(classifyDestName("equation.2.5")).toEqual({ kind: "float", floatKind: "equation", label: "2.5" });
  });

  it("1.1a maps table names to a table float", () => {
    expect(classifyDestName("table.2")).toEqual({ kind: "float", floatKind: "table", label: "2" });
  });

  it("1.1a gives figure.caption.5 a figure float with a null label", () => {
    expect(classifyDestName("figure.caption.5")).toEqual({ kind: "float", floatKind: "figure", label: null });
  });

  it("1.1a returns null for section.3, Item.12, page.4, cite.Green and opaque names", () => {
    expect(classifyDestName("section.3")).toBeNull();
    expect(classifyDestName("Item.12")).toBeNull();
    expect(classifyDestName("page.4")).toBeNull();
    expect(classifyDestName("cite.Green")).toBeNull();
    expect(classifyDestName("a1b2c3d4")).toBeNull();
  });
});

describe("classifyLinkText", () => {
  it("1.1b reads 'by Theorem 2.1' and 'see Lemma 3' as statements", () => {
    expect(classifyLinkText("by Theorem 2.1")).toEqual({ kind: "statement" });
    expect(classifyLinkText("see Lemma 3")).toEqual({ kind: "statement" });
  });

  it("1.1b reads abbreviations, plurals, sub-letters and Portuguese words as statements", () => {
    expect(classifyLinkText("by Thm. 1.2")).toEqual({ kind: "statement" });
    expect(classifyLinkText("Proposition 3a")).toEqual({ kind: "statement" });
    expect(classifyLinkText("combining Theorems 2")).toEqual({ kind: "statement" });
    expect(classifyLinkText("pelo Teorema 3")).toEqual({ kind: "statement" });
  });

  it("1.1b reads 'Fig. 4' as a figure float with label 4", () => {
    expect(classifyLinkText("as shown in Fig. 4")).toEqual({ kind: "float", floatKind: "figure", label: "4" });
  });

  it("1.1b reads 'Table 2' as a table float with label 2", () => {
    expect(classifyLinkText("results in Table 2")).toEqual({ kind: "float", floatKind: "table", label: "2" });
  });

  it("1.1b matches float words case-insensitively and in Portuguese", () => {
    expect(classifyLinkText("FIGURE 3")).toEqual({ kind: "float", floatKind: "figure", label: "3" });
    expect(classifyLinkText("na Tabela 5")).toEqual({ kind: "float", floatKind: "table", label: "5" });
  });

  it("1.1b reads 'equation (3.1)' as an equation float with label 3.1", () => {
    expect(classifyLinkText("by equation (3.1)")).toEqual({ kind: "float", floatKind: "equation", label: "3.1" });
  });

  it("1.1b reads a bare '(3.1)' as an equation float with label 3.1", () => {
    expect(classifyLinkText("we obtain (3.1)")).toEqual({ kind: "float", floatKind: "equation", label: "3.1" });
  });

  it("1.1b returns null for 'see [12]'", () => {
    expect(classifyLinkText("see [12]")).toBeNull();
  });

  it("1.1b returns null when the statement or float word has no number at the end", () => {
    expect(classifyLinkText("by the Theorem")).toBeNull();
    expect(classifyLinkText("the Figure")).toBeNull();
  });
});

describe("deriveStatementRegion", () => {
  it("1.1c contains the three lines of a theorem and excludes the following Proof line", () => {
    const lines = [
      ...body(750, 5),
      line(THM, 675),
      line(CONT, 660),
      line(CONT, 645),
      line("Proof. Apply the intermediate value argument to the function g", 630),
      ...body(615, 3),
    ];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 });
    expect(region).not.toBeNull();
    expect(region!.yTop).toBeGreaterThanOrEqual(675);
    expect(region!.yBottom).toBeLessThanOrEqual(645);
    expect(region!.yBottom).toBeGreaterThan(630);
  });

  it("1.1c keeps the region inside the page and the single column's full width", () => {
    const lines = [...body(750, 5), line(THM, 675), line(CONT, 660), line("Proof. Apply it", 645), ...body(630, 3)];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 })!;
    expect(region.x0).toBeGreaterThanOrEqual(0);
    expect(region.x1).toBeLessThanOrEqual(W);
    expect(region.yTop).toBeLessThanOrEqual(H);
    expect(region.yBottom).toBeGreaterThanOrEqual(0);
  });

  it("1.1d keeps an indented display line inside the statement across a gap of about 2 pitches", () => {
    const lines = [
      ...body(750, 5),
      line(THM, 675),
      line(CONT, 660),
      line("x^2 + y^2 = z^2", 630, { x: 150, xEnd: 400 }),
      line("where z is a positive real number depending on the data", 615),
      line("Proof. Apply the intermediate value argument", 600),
      ...body(585, 3),
    ];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 })!;
    expect(region).not.toBeNull();
    expect(region.yBottom).toBeLessThanOrEqual(630);
    expect(region.yBottom).toBeGreaterThan(600);
  });

  it("1.1d stops at a gap of about 2 pitches between two full-width lines", () => {
    const lines = [
      ...body(750, 5),
      line(THM, 675),
      line(CONT, 660),
      line("a new paragraph of ordinary prose starts well below the statement", 630),
      ...body(615, 3),
    ];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 })!;
    expect(region).not.toBeNull();
    expect(region.yBottom).toBeLessThanOrEqual(660);
    expect(region.yBottom).toBeGreaterThan(630);
  });

  it("1.1e stops before the next statement heading", () => {
    const lines = [
      ...body(750, 5),
      line(THM, 675),
      line(CONT, 660),
      line("Lemma 2.2. Let g be a continuous function on the same interval", 645),
      line(CONT, 630),
      ...body(615, 3),
    ];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 })!;
    expect(region).not.toBeNull();
    expect(region.yBottom).toBeLessThanOrEqual(660);
    expect(region.yBottom).toBeGreaterThan(645);
  });

  it("1.1e stops before a numbered section heading", () => {
    const lines = [
      ...body(750, 5),
      line(THM, 675),
      line(CONT, 660),
      line("3.2 Main results", 645),
      ...body(630, 3),
    ];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 })!;
    expect(region).not.toBeNull();
    expect(region.yBottom).toBeLessThanOrEqual(660);
    expect(region.yBottom).toBeGreaterThan(645);
  });

  it("1.1e stops before a roman-numeral section heading", () => {
    const lines = [
      ...body(750, 5),
      line(THM, 675),
      line(CONT, 660),
      line("IV. Related Work", 645),
      ...body(630, 3),
    ];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 675 })!;
    expect(region).not.toBeNull();
    expect(region.yBottom).toBeGreaterThan(645);
  });

  it("1.1e caps the region at half the page height", () => {
    const lines = [line(THM, 700), ...body(685, 40)];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 700 })!;
    expect(region).not.toBeNull();
    expect(region.yTop - region.yBottom).toBeLessThanOrEqual(H / 2);
    // it still grows well past a few lines before the cap bites
    expect(region.yTop - region.yBottom).toBeGreaterThan(H / 2 - 60);
  });

  it("1.1f uses only right-column lines and keeps x0 >= columnSplit when dest.x is in the right column", () => {
    const left = [...body(751, 11, LEFT)];
    const right = [
      ...body(750, 5, RIGHT),
      line(THM, 675, RIGHT),
      line(CONT, 660, RIGHT),
      line(CONT, 645, RIGHT),
      line("Proof. Apply the argument", 630, RIGHT),
      ...body(615, 3, RIGHT),
    ];
    // left-column lines sit a hair above the destination, so mixing columns would pick one of them as the start line
    const lines = [...left, ...right];
    const region = deriveStatementRegion(lines, twoCol, { x: 400, y: 675 });
    expect(region).not.toBeNull();
    expect(region!.x0).toBeGreaterThanOrEqual(SPLIT);
    expect(region!.x1).toBeLessThanOrEqual(W);
    expect(region!.yBottom).toBeLessThanOrEqual(645);
    expect(region!.yBottom).toBeGreaterThan(630);
  });

  it("1.1f uses only left-column lines and keeps x1 <= columnSplit when dest.x is in the left column", () => {
    const left = [
      ...body(750, 5, LEFT),
      line(THM, 675, LEFT),
      line(CONT, 660, LEFT),
      line("Proof. Apply the argument", 645, LEFT),
      ...body(630, 3, LEFT),
    ];
    const right = [...body(676, 10, RIGHT)];
    const region = deriveStatementRegion([...left, ...right], twoCol, { x: 150, y: 675 });
    expect(region).not.toBeNull();
    expect(region!.x0).toBeGreaterThanOrEqual(0);
    expect(region!.x1).toBeLessThanOrEqual(SPLIT);
    expect(region!.yBottom).toBeLessThanOrEqual(660);
    expect(region!.yBottom).toBeGreaterThan(645);
  });

  it("1.1f lets the start line decide the column when dest.x is null on a split page", () => {
    const left = [...body(750, 4, LEFT)];
    const right = [
      ...body(750, 5, RIGHT),
      line(THM, 675, RIGHT),
      line(CONT, 660, RIGHT),
      line("Proof. Apply the argument", 645, RIGHT),
      ...body(630, 3, RIGHT),
    ];
    const region = deriveStatementRegion([...left, ...right], twoCol, { x: null, y: 675 });
    expect(region).not.toBeNull();
    expect(region!.x0).toBeGreaterThanOrEqual(SPLIT);
    expect(region!.yBottom).toBeGreaterThan(645);
  });

  it("1.1g returns null when the nearest line under the destination is out of reach", () => {
    const lines = body(400, 10);
    expect(deriveStatementRegion(lines, single, { x: 100, y: 700 })).toBeNull();
  });

  it("1.1g returns null when every line lies above the destination", () => {
    const lines = body(750, 10);
    expect(deriveStatementRegion(lines, single, { x: 100, y: 50 })).toBeNull();
  });

  it("1.1g returns null when there are no lines", () => {
    expect(deriveStatementRegion([], single, { x: 100, y: 400 })).toBeNull();
  });

  it("1.1g returns null when the destination's column has no line under it", () => {
    const left = body(500, 10, LEFT);
    const right = body(750, 3, RIGHT);
    expect(deriveStatementRegion([...left, ...right], twoCol, { x: 400, y: 600 })).toBeNull();
  });

  it("1.1g still finds a region when the start line is a little below the destination", () => {
    const lines = [...body(750, 4), line(THM, 675), line(CONT, 660), line("Proof. Apply it", 645), ...body(630, 3)];
    const region = deriveStatementRegion(lines, single, { x: 100, y: 688 });
    expect(region).not.toBeNull();
    expect(region!.yBottom).toBeLessThanOrEqual(660);
  });
});

describe("findFloatCaptionNear", () => {
  const caps = (): TextLine[] => [
    ...body(750, 3),
    line("Figure 1: The first figure", 600),
    ...body(580, 3),
    line("Figure 2: The second figure", 300),
    line("Table 1: A table of values", 200),
    ...body(180, 3),
  ];
  const figure = (label: string | null) => ({ floatKind: "figure" as const, label });

  it("1.1h picks the caption whose label matches, even when another figure caption is closer", () => {
    const lines = caps();
    const hit = findFloatCaptionNear(lines, single, figure("1"), { x: 100, y: 310 });
    expect(hit).toMatchObject({ kind: "figure", label: "1", lineIndex: 3 });
  });

  it("1.1h falls back to the label without its sub-figure letter", () => {
    const hit = findFloatCaptionNear(caps(), single, figure("2a"), { x: 100, y: 650 });
    expect(hit).toMatchObject({ kind: "figure", label: "2" });
  });

  it("1.1h ignores captions of another kind when matching the label", () => {
    const hit = findFloatCaptionNear(caps(), single, { floatKind: "table", label: "1" }, { x: 100, y: 650 });
    expect(hit).toMatchObject({ kind: "table", label: "1" });
  });

  it("1.1h without a label match picks the caption at or below the destination with the greatest y", () => {
    const hit = findFloatCaptionNear(caps(), single, figure("9"), { x: 100, y: 650 });
    expect(hit).toMatchObject({ kind: "figure", label: "1" });
    const lower = findFloatCaptionNear(caps(), single, figure(null), { x: 100, y: 350 });
    expect(lower).toMatchObject({ kind: "figure", label: "2" });
  });

  it("1.1h picks the nearest caption when none lies at or below the destination", () => {
    const hit = findFloatCaptionNear(caps(), single, figure(null), { x: 100, y: 100 });
    expect(hit).toMatchObject({ kind: "figure", label: "2" });
  });

  it("1.1h returns null when the page has no caption of that kind", () => {
    const lines = [...body(750, 3), line("Table 1: A table of values", 400), ...body(380, 3)];
    expect(findFloatCaptionNear(lines, single, figure(null), { x: 100, y: 400 })).toBeNull();
    expect(findFloatCaptionNear([], single, figure("1"), { x: 100, y: 400 })).toBeNull();
  });

  describe("on a two-column page", () => {
    const lines = (): TextLine[] => [
      ...body(750, 3, LEFT),
      line("Figure 1: Left caption", 400, LEFT),
      ...body(380, 3, LEFT),
      ...body(750, 3, RIGHT),
      line("Figure 2: Right caption", 500, RIGHT),
      ...body(480, 3, RIGHT),
    ];

    it("1.1h keeps only captions in the destination's right column", () => {
      // a mixed search would take the left caption (y 400 <= 452); the right column has only one above
      const hit = findFloatCaptionNear(lines(), twoCol, figure(null), { x: 400, y: 450 });
      expect(hit).toMatchObject({ kind: "figure", label: "2" });
    });

    it("1.1h keeps only captions in the destination's left column", () => {
      // a mixed search would take the right caption (y 500, the greatest at or below 522)
      const hit = findFloatCaptionNear(lines(), twoCol, figure(null), { x: 150, y: 520 });
      expect(hit).toMatchObject({ kind: "figure", label: "1" });
    });

    it("1.1h still returns a label match from the other column", () => {
      const hit = findFloatCaptionNear(lines(), twoCol, figure("1"), { x: 400, y: 450 });
      expect(hit).toMatchObject({ kind: "figure", label: "1" });
    });
  });
});
