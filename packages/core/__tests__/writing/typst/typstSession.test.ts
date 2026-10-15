/** Verifies a Typst session compiles with the real WASM compiler and serializes concurrent requests. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { TypstSession } from "../../../src/writing/typst/index";
import { toCompilerPath } from "../../../src/writing/typst/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { openTestSession, TYPST_TEST_FONT_SETTING } from "../../support/typstFixtures";

afterEach(cleanupTempDirs);

let session: TypstSession;
beforeAll(async () => { session = await openTestSession({ resolve: () => undefined }); });

async function projectWith(text: string): Promise<{ root: string; main: string }> {
  const folder = await makeTempDir();
  await fs.writeFile(path.join(folder, "main.typ"), text);
  return { root: toCompilerPath(folder), main: toCompilerPath(path.join(folder, "main.typ")) };
}

describe("TypstSession", () => {
  it("returns PDF bytes for a valid document", async () => {
    const result = await session.compile({ ...(await projectWith(`${TYPST_TEST_FONT_SETTING}Hi`)), sources: new Map() });
    expect(Buffer.from(result.pdf!).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("returns diagnostics and no PDF for an invalid document", async () => {
    const result = await session.compile({ ...(await projectWith(`${TYPST_TEST_FONT_SETTING}#bogus()`)), sources: new Map() });
    expect(result.pdf).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", range: expect.stringMatching(/^1:/) });
  });

  it("resolves concurrent compiles each with its own result", async () => {
    const good = await projectWith(`${TYPST_TEST_FONT_SETTING}Hi`);
    const bad = await projectWith(`${TYPST_TEST_FONT_SETTING}#bogus()`);
    const shadowed = await projectWith(`${TYPST_TEST_FONT_SETTING}#bogus()`);
    const [a, b, c] = await Promise.all([
      session.compile({ ...good, sources: new Map() }),
      session.compile({ ...bad, sources: new Map() }),
      session.compile({ ...shadowed, sources: new Map([[shadowed.main, `${TYPST_TEST_FONT_SETTING}ok`]]) }),
    ]);
    expect(a.pdf).toBeDefined();
    expect(b.pdf).toBeUndefined();
    expect(c.pdf).toBeDefined();
  });

  it("does not carry shadowed sources into the next compile", async () => {
    const project = await projectWith(`${TYPST_TEST_FONT_SETTING}#bogus()`);
    await session.compile({ ...project, sources: new Map([[project.main, `${TYPST_TEST_FONT_SETTING}ok`]]) });
    expect((await session.compile({ ...project, sources: new Map() })).pdf).toBeUndefined();
  });
});
