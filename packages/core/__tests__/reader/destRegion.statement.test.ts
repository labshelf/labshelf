// Pins deriveStatementRegion and findStatementStart: the region of a theorem-like statement and where it starts.
import { deriveStatementRegion, findStatementStart } from "../../src/reader/destRegion";
import { W, H, SPLIT, single, twoCol, line, body, THM, CONT, LEFT, RIGHT } from "./destRegionHarness";

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

