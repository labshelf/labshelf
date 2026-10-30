import {
  classifyDestName,
  classifyLinkText,
  deriveStatementRegion,
  findFloatCaptionNear,
  findStatementStart,
} from "../../src/reader/destTarget";
import type { PageLayout } from "../../src/reader/destTarget";
import type { TextLine } from "../../src/reader/textLines";
import { deriveFloatRegion, type PdfRegion } from "../../src/reader/geometry";

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

// Regression: hover previews on real page geometry, lines extracted with pdf.js the way PageTextCache does.
const PAGE = { width: 612, height: 792, columnSplit: null };
const at = (y: number, x: number, xEnd: number, text: string, height = 12): TextLine => ({ text, x, xEnd, y, height, column: 0 });

const contains = (r: PdfRegion, l: TextLine): boolean => r.yTop >= l.y + 0.7 * l.height && r.yBottom <= l.y;
const excludesAbove = (r: PdfRegion, l: TextLine): boolean => l.y >= r.yTop;
const excludesBelow = (r: PdfRegion, l: TextLine): boolean => l.y + 0.7 * l.height <= r.yBottom;

describe('statement preview of a hyperref theorem link (Green & Tao, arXiv math/0404188, page 2)', () => {
  // amsart theorems share the subsection counter: the links point at "subsection.1.1" / "subsection.1.2", XYZ dests whose
  // y sits in the gap above the heading, about 8pt under the previous paragraph's last baseline.
  const before11 = at(515.7, 81.5, 332.2, 'Our main theorem resolves the above conjecture.');
  const thm11 = [
    at(494.1, 81.5, 525.2, 'Theorem 1.1. The prime numbers contain infinitely many arithmetic progressions of'),
    at(480.2, 81.5, 171.9, 'length k for all k.'),
  ];
  const before12 = at(458.6, 81.5, 320.0, 'In fact, we can say something a little stronger:');
  const thm12 = [
    at(437.1, 81.5, 525.2, 'Theorem 1.2 (Szemer´edi’s theorem in the primes). Let A be any subset of the prime'),
    at(423.2, 81.5, 525.2, 'numbers of positive relative upper density, thus lim sup π(N)−1|A ∩ [1, N]| > 0,'),
    at(420.3, 371.2, 395.7, 'N→∞', 8),
    at(409.3, 81.5, 525.2, 'where π(N) denotes the number of primes less than or equal to N. Then A contains'),
    at(395.3, 81.5, 388.5, 'infinitely many arithmetic progressions of length k for all k.'),
  ];
  const after12 = at(373.8, 81.5, 525.1, 'If one replaces “primes” in the statement of Theorem 1.2 by the set of all positive integers');
  // The whole body of page 2 as pdf.js extracts it, so the column's median line pitch is the body spacing (about 13.9pt)
  // and not the paragraph gap.
  const head = [
    at(755.7, 81.5, 379.3, '2 BEN GREEN AND TERENCE TAO', 9),
    at(731.9, 81.5, 525.2, 'such result is due to Heath-Brown [25]. He showed that there are infinitely many 4-term'),
    at(717.9, 81.5, 525.1, 'progressions consisting of three primes and a number which is either prime or a product'),
    at(704.0, 81.5, 525.2, 'of two primes. In a somewhat different direction, let us mention the beautiful results of'),
    at(690.0, 81.5, 525.1, 'Balog [2, 3]. Among other things he shows that for any m there are m distinct primes'),
    at(676.1, 81.5, 389.7, 'p , . . . , p such that all of the averages 1(p + p ) are prime.'),
    at(674.3, 87.4, 328.3, '1 m 2 i j', 8),
    at(651.2, 81.5, 525.2, 'The problem of finding long arithmetic progressions in the primes has also attracted the'),
    at(637.2, 81.5, 525.0, 'interest of computational mathematicians. At the time of writing the longest known'),
    at(623.3, 81.5, 525.2, 'arithmetic progression of primes is of length 23, and was found in 2004 by Markus Frind,'),
    at(609.3, 81.5, 264.6, 'Paul Underwood, and Paul Jobling:'),
    at(589.4, 162.2, 444.5, '56211383760397 + 44546738095860k; k = 0, 1, . . . , 22.'),
    at(569.5, 81.5, 525.1, 'An earlier arithmetic progression of primes of length 22 was found by Moran, Pritchard'),
    at(555.6, 81.5, 171.4, 'and Thyssen [32]:'),
    at(535.7, 165.2, 441.5, '11410337850553 + 4609098694200k; k = 0, 1, . . . , 21.'),
  ];
  const tail = [
    at(359.9, 81.5, 525.1, 'Z+, then this is a famous theorem of Szemer´edi [38]. The special case k = 3 of Theorem'),
    at(345.8, 81.5, 525.0, '1.2 was recently established by the first author [21] using methods of Fourier analysis.'),
    at(331.9, 81.5, 525.0, 'In contrast, our methods here have a more ergodic theory flavour and do not involve'),
    at(318.0, 81.5, 525.0, 'much Fourier analysis (though the argument does rely on Szemer´edi’s theorem which'),
    at(304.1, 81.5, 525.0, 'can be proven by either combinatorial, ergodic theory, or Fourier analysis arguments).'),
    at(290.0, 81.5, 525.0, 'We also remark that if the primes were replaced by a random subset of the integers,'),
    at(276.1, 81.5, 525.1, 'with density at least N−1/2+ε on each interval [1, N], then the k = 3 case of the above'),
    at(262.2, 81.5, 244.6, 'theorem was established in [30].'),
    at(237.2, 81.5, 525.0, 'Acknowledgements The authors would like to thank Jean Bourgain, Enrico Bombieri,'),
    at(223.3, 81.5, 525.2, 'Tim Gowers, Bryna Kra, Elon Lindenstrauss, Imre Ruzsa, Roman Sasyk, Peter Sarnak'),
    at(209.4, 81.5, 525.2, 'and Kannan Soundararajan for helpful conversations. We are particularly indebted to'),
    at(195.5, 81.5, 525.2, 'Andrew Granville for drawing our attention to the work of Goldston and Yıldırım, and to'),
    at(181.4, 81.5, 525.4, 'Dan Goldston for making the preprint [17] available. We are also indebted to Yong-Gao'),
    at(167.5, 81.5, 525.1, 'Chen and his students, Bryna Kra, Jamie Radcliffe, Lior Silberman and Mark Watkins'),
    at(153.6, 81.5, 525.2, 'for corrections to earlier versions of the manuscript. We are particularly indebted to'),
    at(139.7, 81.5, 525.2, 'the anonymous referees for a very thorough reading and many helpful corrections and'),
    at(125.7, 81.5, 525.2, 'suggestions, which have been incorporated into this version of the paper. Portions of'),
    at(111.7, 81.5, 525.2, 'this work were completed while the first author was visiting UCLA and Universit´e de'),
    at(97.8, 81.5, 525.0, 'Montr´eal, and he would like to thank these institutions for their hospitality. He would'),
    at(83.9, 81.5, 471.1, 'also like to thank Trinity College, Cambridge for support over several years.'),
  ];
  const lines = [...head, before11, ...thm11, before12, ...thm12, after12, ...tail];

  it('1.3a crops Theorem 1.2 from its heading to its last line, not the line above the anchor', () => {
    const region = deriveStatementRegion(lines, PAGE, { x: 81.5155487, y: 467.154053 });
    expect(region).not.toBeNull();
    for (const l of thm12) { expect(contains(region!, l)).toBe(true); }
    expect(excludesAbove(region!, before12)).toBe(true);
    expect(excludesBelow(region!, after12)).toBe(true);
  });

  it('1.3a crops Theorem 1.1 from its heading to its last line, not the line above the anchor', () => {
    const region = deriveStatementRegion(lines, PAGE, { x: 81.5155487, y: 524.367798 });
    expect(region).not.toBeNull();
    for (const l of thm11) { expect(contains(region!, l)).toBe(true); }
    expect(excludesAbove(region!, before11)).toBe(true);
    expect(excludesBelow(region!, before12)).toBe(true);
  });

  it('1.3c findStatementStart returns the heading line index for the Theorem 1.2 anchor', () => {
    const idx = findStatementStart(lines, PAGE, { x: 81.5155487, y: 467.154053 });
    expect(idx).toBe(lines.indexOf(thm12[0]!));
  });

  it('1.3c findStatementStart returns the heading line index for the Theorem 1.1 anchor', () => {
    const idx = findStatementStart(lines, PAGE, { x: 81.5155487, y: 524.367798 });
    expect(idx).toBe(lines.indexOf(thm11[0]!));
  });

  it('A1 the Theorem 1.2 anchor yields a start at the heading and a region of exactly the statement', () => {
    const dest = { x: 81.5155487, y: 467.154053 };
    const idx = findStatementStart(lines, PAGE, dest);
    expect(idx).not.toBeNull();
    expect(lines[idx!]!.text).toMatch(/^Theorem 1\.2/);
    const region = deriveStatementRegion(lines, PAGE, dest);
    expect(region).not.toBeNull();
    for (const l of thm12) { expect(contains(region!, l)).toBe(true); }
    expect(excludesAbove(region!, before12)).toBe(true);
    expect(excludesBelow(region!, after12)).toBe(true);
  });
});

describe('findStatementStart', () => {
  it('1.3c returns null for a dest above a numbered section heading', () => {
    const lines = [
      ...body(760, 3),
      line('2. Preliminaries', 600, { height: 14 }),
      ...body(580, 3),
    ];
    expect(findStatementStart(lines, single, { x: 72, y: 620 })).toBeNull();
  });

  it('1.3c returns null for a dest above a roman-numeral section heading', () => {
    const lines = [...body(760, 3), line('II. RELATED WORK', 600, { height: 14 }), ...body(580, 3)];
    expect(findStatementStart(lines, single, { x: 72, y: 620 })).toBeNull();
  });

  it('1.3c returns null for a dest above a plain paragraph', () => {
    const lines = [...body(760, 3), ...body(600, 4)];
    expect(findStatementStart(lines, single, { x: 72, y: 615 })).toBeNull();
  });

  it('1.3c returns the heading index for a dest in the gap above a statement heading', () => {
    const lines = [...body(760, 2), line(THM, 600), line(CONT, 585), ...body(560, 2)];
    expect(findStatementStart(lines, single, { x: 72, y: 625 })).toBe(2);
  });
});

describe('figure preview of a hyperref figure link (Mnih et al. 2013, "Playing Atari", page 7)', () => {
  // Figure 2 is four plots ABOVE its caption; their small-font tick labels and axis titles are extracted as text and
  // the four panels' labels on one baseline join into page-wide lines. Figure 3's graphic and caption follow below.
  const lines = [
    at(704.8, 134.8, 481.9, 'Average Reward on Breakout Average Reward on Seaquest Average Q on Breakout Average Q on Seaquest', 4),
    at(702.0, 114.1, 419.8, '250 1800 4 9', 4),
    at(696.3, 211.5, 419.8, '1600 3.5 8', 4),
    at(691.8, 114.1, 419.8, '200 1400 7', 4),
    at(689.3, 317.9, 320.2, '3', 4),
    at(685.0, 211.5, 419.8, '1200 6', 4),
    at(681.6, 114.1, 320.2, '150 2.5', 4),
    at(679.4, 211.5, 419.8, '1000 5', 4),
    at(676.5, 317.9, 320.2, '2', 4),
    at(673.7, 213.8, 419.8, '800 4', 4),
    at(671.4, 114.1, 320.2, '100 1.5', 4),
    at(668.0, 213.8, 419.8, '600 3', 4),
    at(662.4, 213.8, 419.8, '400 1 2', 4),
    at(661.3, 116.4, 120.9, '50', 4),
    at(656.7, 213.8, 419.8, '200 0.5 1', 4),
    at(651.1, 118.6, 419.8, '0 0 0 0', 4),
    at(647.5, 122.0, 503.1, '0 10 20 30 40 50 60 70 80 90 100 0 10 20 30 40 50 60 70 80 90 100 0 10 20 30 40 50 60 70 80 90 100', 4),
    at(643.5, 146.7, 474.9, 'Training Epochs Training Epochs Training Epochs Training Epochs', 4),
    at(610.3, 108.0, 504.0, 'Figure 2: The two plots on the left show average reward per episode on Breakout and Seaquest', 10),
    at(599.4, 108.0, 504.0, 'respectively during training. The statistics were computed by running an ε-greedy policy with ε =', 10),
    at(588.4, 108.0, 504.0, '0.05 for 10000 steps. The two plots on the right show the average maximum predicted action-value', 10),
    at(577.5, 108.0, 504.0, 'of a held out set of states on Breakout and Seaquest respectively. One epoch corresponds to 50000', 10),
    at(566.5, 108.0, 368.1, 'minibatch weight updates or roughly 30 minutes of training time.', 10),
    at(463.0, 108.0, 504.0, 'Figure 3: The leftmost plot shows the predicted value function for a 30 frame segment of the game', 10),
    at(452.0, 108.0, 482.2, 'Seaquest. The three screenshots correspond to the frames labeled by A, B, and C respectively.', 10),
  ];

  it('1.3a shows the whole figure above its caption, not the space below the caption', () => {
    // Link "figure.2": XYZ dest at y = 642.228, just under the plots.
    const hit = findFloatCaptionNear(lines, PAGE, { floatKind: 'figure', label: '2' }, { x: 108, y: 642.228 });
    expect(hit).not.toBeNull();
    expect(lines[hit!.lineIndex]!.text).toMatch(/^Figure 2:/);
    const region = deriveFloatRegion(lines, hit!, PAGE.width, PAGE.height, PAGE.columnSplit);
    // The plot titles at the top of the figure and the whole caption are inside; Figure 3's caption is not.
    expect(contains(region, lines[0]!)).toBe(true);
    expect(contains(region, lines[22]!)).toBe(true);
    expect(excludesBelow(region, lines[23]!)).toBe(true);
  });

  it('A2 covers the four plot titles, the plots and the caption of Figure 2', () => {
    const hit = findFloatCaptionNear(lines, PAGE, { floatKind: 'figure', label: '2' }, { x: 108, y: 642.228 });
    expect(hit).not.toBeNull();
    const region = deriveFloatRegion(lines, hit!, PAGE.width, PAGE.height, PAGE.columnSplit);
    expect(contains(region, lines[0]!)).toBe(true); // plot titles
    expect(contains(region, lines[17]!)).toBe(true); // x-axis titles
    for (const i of [18, 19, 20, 21, 22]) { expect(contains(region, lines[i]!)).toBe(true); }
  });
});

describe('deriveFloatRegion with full-height body text above a figure', () => {
  it('1.3b still bounds the band at the body text when small-font labels sit inside the figure', () => {
    const lines = [
      ...body(760, 4),
      line('0 10 20 30 40', 600, { x: 100, xEnd: 500, height: 4 }),
      line('Time Time', 480, { x: 100, xEnd: 500, height: 4 }),
      line('Figure 1: caption below the plot', 430, { height: 11 }),
      ...body(400, 8),
    ];
    const region = deriveFloatRegion(lines, { kind: 'figure', label: '1', lineIndex: 6 }, W, H, null);
    // last body line above the figure is at y 715
    expect(region.yTop).toBeLessThanOrEqual(715 + 1);
    expect(region.yTop).toBeGreaterThan(640);
    expect(region.yBottom).toBeLessThan(430);
  });
});
