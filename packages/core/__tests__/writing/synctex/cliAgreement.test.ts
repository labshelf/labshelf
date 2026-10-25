// Tests that source lookup in both directions agrees with the reference `synctex` command line on a real two-page build.
import * as fs from "node:fs";
import * as path from "node:path";

import { parseSynctex, findPagePoint, findSourcePosition } from "../../../src/writing/synctex";

const index = parseSynctex(fs.readFileSync(path.join(__dirname, "fixtures/main.synctex"), "utf8"), "/work/project");
const project = (file: string): string => `/work/project/${file}`;

describe("findSourcePosition (synctex edit)", () => {
  // `synctex edit -o page:x:y:main.pdf` printed this file and line.
  it.each([
    [1, 168.14, 131.76, "main.tex", 3],
    [1, 168.14, 153.59, "main.tex", 4],
    [1, 168.14, 165.54, "main.tex", 6],
    [1, 168.14, 198.49, "chapter.tex", 1],
    [1, 168.14, 220.31, "chapter.tex", 2],
    [1, 168.14, 232.26, "chapter.tex", 4],
    [2, 168.14, 131.76, "main.tex", 9],
    [2, 168.14, 153.59, "main.tex", 10],
    [2, 443.11, 153.59, "chapters/extra.tex", 1],
  ])("page %i at (%f, %f) is %s line %i", (page, x, y, file, line) => {
    expect(findSourcePosition(index, { page, x, y })).toEqual({ file: project(file), line });
  });

  it("answers for a point between lines and outside the text with the closest line", () => {
    expect(findSourcePosition(index, { page: 1, x: 10, y: 10 })).toBeDefined();
    expect(findSourcePosition(index, { page: 1, x: 168.14, y: 145 })?.file).toBe(project("main.tex"));
  });

  it("has no answer for a page the build did not produce", () => {
    expect(findSourcePosition(index, { page: 3, x: 100, y: 100 })).toBeUndefined();
  });
});

describe("findPagePoint (synctex view)", () => {
  // `synctex view -i line:1:file -o main.pdf` printed this page and point; the point is the line's first position, within 5 points.
  it.each([
    ["main.tex", 3, 1, 133.77, 134.76],
    ["main.tex", 4, 1, 158.07, 156.59],
    ["main.tex", 6, 1, 179.15, 168.54],
    ["main.tex", 9, 2, 133.77, 134.76],
    ["main.tex", 10, 2, 165.93, 156.59],
    ["chapter.tex", 1, 1, 133.77, 201.49],
    ["chapter.tex", 2, 1, 156.52, 223.31],
    ["chapter.tex", 4, 1, 184.44, 235.26],
    ["chapters/extra.tex", 1, 2, 336.32, 156.59],
  ])("%s line %i is on page %i near (%f, %f)", (file, line, page, x, y) => {
    const point = findPagePoint(index, project(file), line);
    expect(point?.page).toBe(page);
    expect(Math.abs((point?.x ?? Infinity) - x)).toBeLessThanOrEqual(5);
    expect(Math.abs((point?.y ?? Infinity) - y)).toBeLessThanOrEqual(5);
  });

  it("maps a line without output to the next line that has some, and a line past the end to the last one", () => {
    const main = project("main.tex");
    const last = index.byFile.get(main)?.lines.at(-1) ?? 0;
    expect(findPagePoint(index, main, 7)).toEqual(findPagePoint(index, main, 8));
    expect(findPagePoint(index, main, last + 40)).toEqual(findPagePoint(index, main, last));
  });

  it("matches the editor's path however the build wrote it", () => {
    expect(findPagePoint(index, "/work/project/chapters/../chapter.tex", 2)).toEqual(findPagePoint(index, project("chapter.tex"), 2));
  });

  it("has no answer for a file the build did not read", () => {
    expect(findPagePoint(index, project("other.tex"), 1)).toBeUndefined();
  });
});
