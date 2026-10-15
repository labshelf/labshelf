// Checks that the terminal's PDF import parser gets the OCR fallback, so scanned PDFs are identified.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { TesseractOcrEngine } from "@labshelf/core/node";

import { openLibrary, type AppContext } from "../../src/app/context";
import { cleanupTempDirs, createTempLibrary, makeTempDir } from "../fixtures/library";

const parserOptions: unknown[] = [];

jest.mock("@labshelf/core", () => {
  const actual = jest.requireActual("@labshelf/core");
  return {
    ...actual,
    PdfImportParser: class {
      constructor(_opener: unknown, options: unknown) { parserOptions.push(options); }
      parse(): Promise<never> { return Promise.reject(new Error("parse is not under test")); }
    },
  };
});

describe("openLibrary", () => {
  let ctx: AppContext | undefined;

  afterEach(async () => {
    await ctx?.dispose();
    await cleanupTempDirs();
  });

  it("builds the PDF import parser with an OCR engine", async () => {
    const lib = await createTempLibrary([]);
    const xdg = await makeTempDir();
    ctx = await openLibrary(lib.root, {
      config: { version: 1 },
      env: { XDG_CONFIG_HOME: xdg, XDG_CACHE_HOME: xdg, LABSHELF_TOKEN_STORE: "file", LABSHELF_IMAGES: "off" },
      watch: false,
      thumbnailWorkerUrl: new URL("file:///unused/thumbnailWorker.mjs"),
    });
    const pdf = path.join(xdg, "scan.pdf");
    await fs.writeFile(pdf, "%PDF-1.4 scan");

    await ctx.papers.importAny([pdf], "");

    expect(parserOptions).toHaveLength(1);
    expect((parserOptions[0] as { ocr?: unknown }).ocr).toBeInstanceOf(TesseractOcrEngine);
  });
});
