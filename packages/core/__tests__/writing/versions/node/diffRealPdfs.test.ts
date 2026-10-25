// Compares real pdfTeX builds, rendered by real pdf.js in a child process the way renderInkMaps renders them.
import { execFileSync } from "node:child_process";
import * as path from "node:path";

import { diffPages, inkMapFromRgba, type InkMap, type PdfChanges } from "../../../../src/writing/versions";
import type { PageArea } from "../../../../src/reader/index.js";

const SCALE = 1.5;
const FIXTURES = path.join(__dirname, "..", "fixtures");

interface Found { word: string; page: number; x: number; y: number }

function render(name: string, ...words: string[]): { pages: InkMap[]; found: Found[] } {
  const json = execFileSync(process.execPath, [path.join(__dirname, "pdfInkDump.mjs"), path.join(FIXTURES, name), String(SCALE), ...words], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const dump = JSON.parse(json) as { pages: Array<{ width: number; height: number; rgba: string }>; found: Found[] };
  return {
    pages: dump.pages.map((page) => inkMapFromRgba(Buffer.from(page.rgba, "base64"), page.width, page.height)),
    found: dump.found,
  };
}

function covers(areas: readonly PageArea[], at: Found): boolean {
  // `y` is the baseline; the glyphs sit just above it.
  return areas.some((area) => area.page === at.page && area.left <= at.x + 2 && area.right >= at.x + 2
    && area.top <= at.y - 3 && area.bottom >= at.y - 3);
}

describe("diffPages on real builds", () => {
  const before = render("before.pdf", "0.913");
  const after = render("after.pdf", "FIRSTEDIT", "0.927");
  let changes: PdfChanges;

  beforeAll(() => {
    changes = diffPages(before.pages, after.pages, SCALE);
  });

  it("finds nothing between a build and itself", () => {
    const same = diffPages(before.pages, before.pages, SCALE);
    expect(same).toEqual({ before: [], after: [] });
  });

  it("marks the inserted sentence and the changed number on the new build", () => {
    const [inserted, number] = ["FIRSTEDIT", "0.927"].map((word) => after.found.find((f) => f.word === word)!);
    expect(covers(changes.after, inserted!)).toBe(true);
    expect(covers(changes.after, number!)).toBe(true);
  });

  it("marks the old number on the old build", () => {
    expect(covers(changes.before, before.found.find((f) => f.word === "0.913")!)).toBe(true);
  });

  it("keeps text that only moved by the insertion, across columns and pages, unmarked", () => {
    // One region per edit and side: the paragraph that grew and the line with the number.
    expect(changes.after).toHaveLength(2);
    expect(changes.before).toHaveLength(2);
  });
});
