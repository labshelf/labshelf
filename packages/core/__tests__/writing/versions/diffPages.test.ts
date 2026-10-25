// Tests the regions comparePages reports as changed, in points with padding, merged per page.
import { diffPages } from "../../../src/writing/versions/diffPages";
import { blankPage, fillBars } from "./inkFixture";

const SCALE = 2;

function page(draw: (p: ReturnType<typeof blankPage>) => void) {
  const map = blankPage(200, 120);
  draw(map);
  return map;
}

// A line the comparison keeps apart from the changed ones: a different height.
const unchanged = (p: ReturnType<typeof blankPage>) => fillBars(p, 20, 90, 38, 4);

describe("comparePages", () => {
  it("reports no area for identical pages", () => {
    const draw = (p: ReturnType<typeof blankPage>) => { fillBars(p, 20, 10, 38, 8); unchanged(p); };
    expect(diffPages([page(draw)], [page(draw)], SCALE)).toEqual({ before: [], after: [] });
  });

  it("reports no area for no pages", () => {
    expect(diffPages([], [], SCALE)).toEqual({ before: [], after: [] });
  });

  it("reports a changed block on each side in points with 1 pt of padding", () => {
    const before = page((p) => { fillBars(p, 20, 10, 38, 8, 4, 2); unchanged(p); });
    const after = page((p) => { fillBars(p, 20, 10, 37, 8, 3, 1); unchanged(p); });
    // before block: x 20..57 (38 wide); after block: x 20..56 (37 wide); both y 10..17.
    expect(diffPages([before], [after], SCALE)).toEqual({
      before: [{ page: 1, left: 9, top: 4, right: 30, bottom: 10 }],
      after: [{ page: 1, left: 9, top: 4, right: 29.5, bottom: 10 }],
    });
  });

  it("clamps the padding at the page's top-left corner", () => {
    const before = page((p) => fillBars(p, 0, 0, 38, 8, 4, 2));
    const after = page(() => undefined);
    const result = diffPages([before], [after], SCALE);
    expect(result.before[0]).toMatchObject({ left: 0, top: 0 });
    expect(result.after).toEqual([]);
  });

  it("merges two vertically adjacent changed lines into one area", () => {
    const before = page((p) => { fillBars(p, 20, 10, 38, 8, 4, 2); fillBars(p, 20, 22, 38, 8, 4, 2); });
    const after = page((p) => { fillBars(p, 20, 10, 38, 8, 3, 1); fillBars(p, 20, 22, 38, 8, 3, 1); });
    const result = diffPages([before], [after], SCALE);
    expect(result.before).toEqual([{ page: 1, left: 9, top: 4, right: 30, bottom: 16 }]);
    expect(result.after).toHaveLength(1);
  });

  it("keeps distant changed lines as separate areas", () => {
    const before = page((p) => { fillBars(p, 20, 10, 38, 8, 4, 2); fillBars(p, 20, 60, 38, 8, 4, 2); });
    const after = page((p) => { fillBars(p, 20, 10, 38, 8, 3, 1); fillBars(p, 20, 60, 38, 8, 3, 1); });
    expect(diffPages([before], [after], SCALE).before).toHaveLength(2);
  });

  it("numbers areas by page", () => {
    const same = (p: ReturnType<typeof blankPage>) => fillBars(p, 20, 10, 38, 8, 4, 2);
    const changed = (p: ReturnType<typeof blankPage>) => fillBars(p, 20, 10, 38, 8, 3, 1);
    const result = diffPages([page(same), page(same)], [page(same), page(changed)], SCALE);
    expect(result.after.map((area) => area.page)).toEqual([2]);
    expect(result.before.map((area) => area.page)).toEqual([2]);
  });

  it("leaves text that moved to another page unmarked", () => {
    const line = (p: ReturnType<typeof blankPage>) => fillBars(p, 20, 10, 38, 8, 4, 2);
    expect(diffPages([page(line), page(() => undefined)], [page(() => undefined), page(line)], SCALE)).toEqual({ before: [], after: [] });
  });
});
