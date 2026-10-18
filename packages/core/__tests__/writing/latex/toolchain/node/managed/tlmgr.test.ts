import { join } from "node:path";

import { createTlmgr, isRollover, TlmgrFailed } from "../../../../../../src/writing/latex/toolchain/node/managed/index";
import { asLogger, createTexFixture, ROLLOVER_MESSAGE, STALE_TLMGR_MESSAGE, writeTexTree, type FakeTlmgr, type TexFixture } from "./fakeTex";

describe("tlmgr", () => {
  let fixture: TexFixture;
  beforeEach(async () => { fixture = await createTexFixture(); });
  afterEach(() => fixture.cleanup());

  async function tlmgrWith(options: FakeTlmgr) {
    const bin = await writeTexTree(join(fixture.texRoot, "tinytex"), 2026, fixture.callsFile, options);
    return createTlmgr(bin, asLogger(fixture.logger));
  }

  it("searches the package of a missing file and installs it", async () => {
    const tlmgr = await tlmgrWith({ rollover: false, installed: ["latex"] });
    const pkg = await tlmgr.searchFile("foo.sty");
    expect(pkg).toBe("foopkg");
    await tlmgr.install([pkg as string]);
    expect(await tlmgr.listInstalled()).toEqual(["latex", "foopkg"]);
    expect((await fixture.calls()).map((call) => call.args)).toEqual([
      ["search", "--global", "--file", "/foo.sty"],
      ["install", "foopkg"],
      ["info", "--list", "--only-installed", "--data", "name"],
    ]);
  });

  it("finds no package for a file nothing provides", async () => {
    const tlmgr = await tlmgrWith({ rollover: false, installed: [] });
    expect(await tlmgr.searchFile("nothing.sty")).toBeNull();
  });

  it("updates itself once and retries when the repository needs a newer tlmgr", async () => {
    const tlmgr = await tlmgrWith({ rollover: false, installed: [], staleSelf: true });
    await tlmgr.install(["foopkg"]);
    expect(await tlmgr.listInstalled()).toEqual(["foopkg"]);
    expect((await fixture.calls()).map((call) => call.args)).toEqual([
      ["install", "foopkg"],
      ["update", "--self"],
      ["install", "foopkg"],
      ["info", "--list", "--only-installed", "--data", "name"],
    ]);
  });

  it("fails with the output when the release rolled over", async () => {
    const tlmgr = await tlmgrWith({ rollover: true, installed: [] });
    const failure = await tlmgr.searchFile("foo.sty").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TlmgrFailed);
    expect(isRollover((failure as TlmgrFailed).output)).toBe(true);
  });
});

describe("isRollover", () => {
  it("recognises the cross-release message and nothing else", () => {
    expect(isRollover(ROLLOVER_MESSAGE)).toBe(true);
    expect(isRollover(STALE_TLMGR_MESSAGE)).toBe(false);
    expect(isRollover("tlmgr: package repository https://x (verified)")).toBe(false);
  });
});
