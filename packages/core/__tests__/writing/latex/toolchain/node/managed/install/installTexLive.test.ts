import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { installTexLive } from "../../../../../../../src/writing/latex/toolchain/node/managed/install/index";
import { asLogger, createTexFixture, INSTALL_TL_MIRROR, type TexFixture } from "../fakeTex";

const TLMGR = { rollover: false, installed: [] };

describe("installTexLive", () => {
  let fixture: TexFixture;
  beforeEach(async () => { fixture = await createTexFixture(); });
  afterEach(() => fixture.cleanup());

  const install = (progress: Array<number | null> = []) => installTexLive(
    { fetchImpl: fixture.fetchImpl, logger: asLogger(fixture.logger) },
    { texRoot: fixture.texRoot, onProgress: (fraction) => { progress.push(fraction); } },
  );

  it("runs install-tl with the scheme-full profile into tex/texlive and reports its progress", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    const progress: Array<number | null> = [];
    await install(progress);
    expect(await readFile(`${fixture.callsFile}.profile`, "utf8")).toContain("selected_scheme scheme-full");
    const [call] = await fixture.calls();
    expect(call?.args.slice(0, 2)).toEqual(["--no-interaction", "--profile"]);
    expect(existsSync(join(fixture.texRoot, "texlive", "bin", "x86_64-linux", "tlmgr"))).toBe(true);
    expect(progress).toEqual(expect.arrayContaining([null, 0.5, 1]));
    expect(await readdir(fixture.texRoot)).toEqual(["texlive"]);
  });

  it("rejects an installer whose SHA-512 differs and runs nothing", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    fixture.routes.set(`${INSTALL_TL_MIRROR}.sha512`, `${"0".repeat(128)}  install-tl-unx.tar.gz\n`);
    await expect(install()).rejects.toThrow(/Checksum mismatch/);
    expect(await fixture.calls()).toEqual([]);
    expect(existsSync(fixture.texRoot)).toBe(false);
  });

  it("rejects a checksum file without a SHA-512", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    fixture.routes.set(`${INSTALL_TL_MIRROR}.sha512`, "not found");
    await expect(install()).rejects.toThrow(/SHA-512/);
  });

  it("fails with the exit code and output when install-tl fails, cleaning its staging", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    await import("node:fs/promises").then((fs) => fs.writeFile(fixture.callsFile, ""));
    await import("node:fs/promises").then((fs) => fs.chmod(fixture.callsFile, 0o444));
    await expect(install()).rejects.toThrow(/exited with code 1[\s\S]*EACCES/);
    expect(await readdir(fixture.texRoot)).toEqual([]);
  });
});
