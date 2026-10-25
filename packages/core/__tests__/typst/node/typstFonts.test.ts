/** Verifies the default Typst fonts are downloaded only when missing, checked against their checksums, and read from storage. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { TYPST_FONTS, TYPST_VERSION } from "../../../src/typst/index";
import { loadTypstFonts, missingTypstFonts } from "../../../src/typst/node/index";
import { fakeLogger } from "../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";
import { respond } from "../../support/typstFixtures";

afterEach(cleanupTempDirs);

function fontsDir(storage: string): string {
  return path.join(storage, TYPST_VERSION);
}

async function writeFonts(storage: string, files: readonly string[]): Promise<void> {
  await fs.mkdir(fontsDir(storage), { recursive: true });
  for (const file of files) { await fs.writeFile(path.join(fontsDir(storage), file), `bytes of ${file}`); }
}

describe("Typst fonts", () => {
  it("lists every font as missing in an empty storage folder", async () => {
    expect(await missingTypstFonts(await makeTempDir())).toEqual(TYPST_FONTS);
  });

  it("lists only the fonts not yet stored", async () => {
    const storage = await makeTempDir();
    await writeFonts(storage, [TYPST_FONTS[0]!.file]);
    const missing = await missingTypstFonts(storage);
    expect(missing).toHaveLength(TYPST_FONTS.length - 1);
    expect(missing.map((font) => font.file)).not.toContain(TYPST_FONTS[0]!.file);
  });

  it("reads stored fonts without fetching when none is missing", async () => {
    const storage = await makeTempDir();
    await writeFonts(storage, TYPST_FONTS.map((font) => font.file));
    const fetchImpl = jest.fn();
    const fonts = await loadTypstFonts(storage, { logger: fakeLogger(), fetch: fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fonts).toHaveLength(TYPST_FONTS.length);
    expect(Buffer.from(fonts[0]!).toString()).toBe(`bytes of ${TYPST_FONTS[0]!.file}`);
  });

  it("fetches only the missing font, from the pinned URL", async () => {
    const storage = await makeTempDir();
    await writeFonts(storage, TYPST_FONTS.slice(1).map((font) => font.file));
    const urls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => { urls.push(url); return respond(200, "not the real font"); };
    await expect(loadTypstFonts(storage, { logger: fakeLogger(), fetch: fetchImpl })).rejects.toThrow(/Checksum mismatch/);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`v${TYPST_VERSION}/files/fonts/${TYPST_FONTS[0]!.file}`);
  });

  it("writes no file for a font whose checksum differs", async () => {
    const storage = await makeTempDir();
    await expect(loadTypstFonts(storage, { logger: fakeLogger(), fetch: async () => respond(200, "tampered") })).rejects.toThrow(/Checksum mismatch/);
    expect(await listFiles(storage)).toEqual([]);
  });

  it("throws when a download fails", async () => {
    await expect(loadTypstFonts(await makeTempDir(), { logger: fakeLogger(), fetch: async () => respond(500) })).rejects.toThrow(/HTTP 500/);
  });
});
