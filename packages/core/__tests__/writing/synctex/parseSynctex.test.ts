// Tests parsing a real pdfTeX SyncTeX file: inputs, pages, boxes in points and the unit, magnification and offset conversion.
import * as fs from "node:fs";
import * as path from "node:path";

import { parseSynctex, pointFor } from "../../../src/writing/synctex";

const text = fs.readFileSync(path.join(__dirname, "fixtures/main.synctex"), "utf8");
const CWD = "/work/project";

describe("parseSynctex", () => {
  it("normalises every input path to an absolute path", () => {
    const index = parseSynctex(text, CWD);
    expect(index.files.get(1)).toBe("/work/project/main.tex");
    expect(index.files.get(6)).toBe("/work/project/chapter.tex");
    // Input 7 is announced in the middle of page 1's records.
    expect(index.files.get(7)).toBe("/work/project/chapters/extra.tex");
  });

  it("resolves inputs written relative to the build folder, as Tectonic records them", () => {
    const relative = text.replace(/\/work\/project\/\.\/(main\.tex)/, "$1").replaceAll("/work/project/./", "./");
    const index = parseSynctex(relative, CWD);
    expect(index.files.get(1)).toBe("/work/project/main.tex");
    expect(index.files.get(7)).toBe("/work/project/chapters/extra.tex");
  });

  it("converts scaled points to PDF points and keeps the pages", () => {
    const index = parseSynctex(text, CWD);
    expect([...index.pages.keys()]).toEqual([1, 2]);
    const page = index.pages.get(1)?.[0];
    // 4736286 sp is one inch, which is 72 PDF points; the page box is 26673152 sp wide.
    expect(page).toMatchObject({ left: expect.closeTo(72, 3), right: expect.closeTo(72 + 405.1, 0) });
  });

  // Expected values are what `synctex view` printed for main.tex line 3 on the same file with the preamble edited.
  describe("scale", () => {
    const headingX = (edited: string): number | undefined =>
      pointFor(parseSynctex(edited, CWD), "/work/project/main.tex", 3)?.x;

    it("scales coordinates by magnification and by unit", () => {
      expect(headingX(text)).toBeCloseTo(133.77, 2);
      expect(headingX(text.replace("Magnification:1000", "Magnification:2000"))).toBeCloseTo(267.54, 2);
      expect(headingX(text.replace("Unit:1", "Unit:2"))).toBeCloseTo(267.54, 2);
    });

    it("adds the offset after magnification and before the unit", () => {
      const offset = text.replace("X Offset:0", "X Offset:65781");
      expect(headingX(offset)).toBeCloseTo(134.77, 2);
      expect(headingX(offset.replace("Magnification:1000", "Magnification:2000"))).toBeCloseTo(268.54, 2);
      expect(headingX(offset.replace("Unit:1", "Unit:2"))).toBeCloseTo(269.54, 2);
    });

    it("lets a post scriptum override the preamble", () => {
      expect(headingX(`${text}Post scriptum:\nMagnification:2000\n`)).toBeCloseTo(267.54, 2);
    });
  });

  it("rejects text that is not a SyncTeX file", () => {
    expect(() => parseSynctex("%PDF-1.5", CWD)).toThrow("Not a SyncTeX file");
  });
});
