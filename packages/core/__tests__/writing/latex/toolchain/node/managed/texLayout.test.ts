import { join } from "node:path";

import { findManagedTex, readTexLiveYear } from "../../../../../../src/writing/latex/toolchain/node/managed/index";
import { createTexFixture, writeTexTree, type TexFixture } from "./fakeTex";

const TLMGR = { rollover: false, installed: [] };

describe("findManagedTex", () => {
  let fixture: TexFixture;
  beforeEach(async () => { fixture = await createTexFixture(); });
  afterEach(() => fixture.cleanup());

  it("finds nothing when no managed TeX is installed", async () => {
    expect(await findManagedTex(fixture.texRoot)).toBeNull();
  });

  it("finds TinyTeX with its bin dir and year", async () => {
    const bin = await writeTexTree(join(fixture.texRoot, "tinytex"), 2025, fixture.callsFile, TLMGR);
    expect(await findManagedTex(fixture.texRoot)).toEqual({ kind: "tinytex", root: join(fixture.texRoot, "tinytex"), binDir: bin, year: 2025 });
  });

  it("prefers TeX Live over TinyTeX", async () => {
    await writeTexTree(join(fixture.texRoot, "tinytex"), 2025, fixture.callsFile, TLMGR);
    const bin = await writeTexTree(join(fixture.texRoot, "texlive"), 2026, fixture.callsFile, TLMGR);
    expect(await findManagedTex(fixture.texRoot)).toEqual({ kind: "texlive", root: join(fixture.texRoot, "texlive"), binDir: bin, year: 2026 });
  });

  it("reads no year from a tree without release-texlive.txt", async () => {
    expect(await readTexLiveYear(join(fixture.texRoot, "absent"))).toBeNull();
  });
});
