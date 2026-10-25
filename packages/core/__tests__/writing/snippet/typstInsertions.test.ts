/** Verifies every Typst symbol and the table and image figures compile with the real Typst compiler, without warnings. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { TypstSession } from "../../../src/typst/index";
import { deriveTypstCompilerPath } from "../../../src/typst/node/index";
import { imageSnippet, MATH_SYMBOLS, symbolSource, tableSnippet } from "../../../src/writing/snippet/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { openTestSession, TYPST_TEST_FONT_SETTING } from "../../support/typstFixtures";
import { expandSnippet } from "./snippetExpansion";

const ONE_PIXEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

afterEach(cleanupTempDirs);

let session: TypstSession;
beforeAll(async () => { session = await openTestSession({ resolve: () => undefined }); });

async function compile(text: string) {
  const folder = await makeTempDir();
  await fs.mkdir(path.join(folder, "images"));
  await fs.writeFile(path.join(folder, "images", "dot.svg"), ONE_PIXEL_SVG);
  await fs.writeFile(path.join(folder, "main.typ"), TYPST_TEST_FONT_SETTING + text);
  return session.compile({ root: deriveTypstCompilerPath(folder), main: deriveTypstCompilerPath(path.join(folder, "main.typ")), sources: new Map() });
}

describe("Typst insertions", () => {
  // TRAP: the test font has no math glyphs, so math mode fails to compile; `#sym.<name>` is the same expression in both modes.
  it("compiles every symbol without an unknown or deprecated name", async () => {
    const result = await compile(MATH_SYMBOLS.map((symbol) => symbolSource(symbol, "typst")).join(" "));
    expect(result.diagnostics).toEqual([]);
    expect(result.pdf).toBeDefined();
  });

  it("compiles a table and an image figure", async () => {
    const text = `${expandSnippet(tableSnippet("typst", { columns: 3, rows: 2 }))}\n${expandSnippet(imageSnippet("typst", "images/dot.svg"))}`;
    const result = await compile(text);
    expect(result.diagnostics).toEqual([]);
    expect(result.pdf).toBeDefined();
  });
});
