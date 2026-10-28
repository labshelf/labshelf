// Tests marked-up PDF building and PDF comparison against real TeX Live builds and real pdf.js renderings.
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { comparePdfPages, derivePageInk, type PageInk, type PdfChanges } from "../../../../src/writing/history/index";
import { buildMarkedUpDiff } from "../../../../src/writing/history/node/index";
import { findExecutable } from "../../../../src/latex/node/index";
import type { PageArea } from "../../../../src/reader/index.js";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const tex = (body: string): string => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

async function sources(root: string, name: string, body: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "main.tex"), tex(body));
  return dir;
}

describe("buildMarkedUpDiff with TeX Live", () => {
  it("compiles a PDF whose source marks the added and deleted words", async () => {
    const [latexdiff, latexmk] = await Promise.all([findExecutable("latexdiff"), findExecutable("latexmk")]);
    if (!latexdiff || !latexmk) { console.warn("latexdiff or latexmk is missing; skipping the real marked-up PDF run"); return; }
    const root = await makeTempDir();
    const beforeDir = await sources(root, "before", "The quick brown fox.");
    const afterDir = await sources(root, "after", "The quick red fox jumps.");
    const outDir = path.join(root, "out");

    const pdf = await buildMarkedUpDiff({
      beforeDir, afterDir, main: "main.tex", outDir, toolchain: { engine: "pdflatex", executable: latexmk }, signal: new AbortController().signal,
    }, fakeLogger());

    expect(pdf).toBe(path.join(outDir, "diff.pdf"));
    expect((await fs.readFile(pdf)).subarray(0, 4).toString()).toBe("%PDF");
    const diff = await fs.readFile(path.join(outDir, "diff.tex"), "utf8");
    expect(diff).toContain("\\DIFdel{brown fox }");
    expect(diff).toContain("\\DIFadd{red fox jumps}");
  }, 60_000);
});

const SCALE = 1.5;
const FIXTURES = path.join(__dirname, "..", "fixtures");

interface Found { word: string; page: number; x: number; y: number }

function render(name: string, ...words: string[]): { pages: PageInk[]; found: Found[] } {
  const json = execFileSync(process.execPath, [path.join(__dirname, "pdfInkDump.mjs"), path.join(FIXTURES, name), String(SCALE), ...words], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const dump = JSON.parse(json) as { pages: Array<{ width: number; height: number; rgba: string }>; found: Found[] };
  return {
    pages: dump.pages.map((page) => derivePageInk(Buffer.from(page.rgba, "base64"), page.width, page.height)),
    found: dump.found,
  };
}

function covers(areas: readonly PageArea[], at: Found): boolean {
  // `y` is the baseline; the glyphs sit just above it.
  return areas.some((area) => area.page === at.page && area.left <= at.x + 2 && area.right >= at.x + 2
    && area.top <= at.y - 3 && area.bottom >= at.y - 3);
}

describe("comparePages on real builds", () => {
  const before = render("before.pdf", "0.913");
  const after = render("after.pdf", "FIRSTEDIT", "0.927");
  let changes: PdfChanges;

  beforeAll(() => {
    changes = comparePdfPages(before.pages, after.pages, SCALE);
  });

  it("finds nothing between a build and itself", () => {
    const same = comparePdfPages(before.pages, before.pages, SCALE);
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
