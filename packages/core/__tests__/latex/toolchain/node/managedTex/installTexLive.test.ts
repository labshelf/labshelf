import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

jest.mock("../../../../../src/latex/node/verify", () => ({
  ...jest.requireActual("../../../../../src/latex/node/verify"),
  TEX_LIVE_SIGNING_KEY: jest.requireActual("../fakeOpenPgp").TEST_SIGNING_KEY.armoredPublicKey,
}));

import { installTexLive } from "../../../../../src/latex/node/texInstallers";
import { armoredSignature, createTestSigningKey } from "../fakeOpenPgp";
import { asLogger, createTexFixture, INSTALL_TL_MIRROR, type TexFixture } from "./fakeTex";

const TLMGR = { rollover: false, installed: [] };

describe("installTexLive", () => {
  let fixture: TexFixture;
  beforeEach(async () => { fixture = await createTexFixture(); });
  afterEach(() => fixture.cleanup());

  const install = (progress: Array<number | null> = []) => installTexLive(
    { fetchImpl: fixture.fetchImpl, logger: asLogger(fixture.logger), platform: "linux" },
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

  it("rejects an installer whose SHA-512 differs from the signed checksum, logs both and runs nothing", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    fixture.serveSignedChecksum(`${"0".repeat(128)}  install-tl-unx.tar.gz\n`);
    await expect(install()).rejects.toThrow(/Checksum mismatch/);
    expect(await fixture.calls()).toEqual([]);
    expect(existsSync(fixture.texRoot)).toBe(false);
    expect(fixture.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.stringMatching(/checksum mismatch/i), expect.objectContaining({
      asset: "install-tl-unx.tar.gz", expected: "0".repeat(128), actual: expect.stringMatching(/^[0-9a-f]{128}$/),
    }));
  });

  it("rejects a checksum whose signature does not match it and runs nothing", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    fixture.routes.set(`${INSTALL_TL_MIRROR}.sha512`, `${"0".repeat(128)}  install-tl-unx.tar.gz\n`);
    await expect(install()).rejects.toThrow(/signature/);
    expect(await fixture.calls()).toEqual([]);
    expect(existsSync(fixture.texRoot)).toBe(false);
    expect(fixture.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.stringMatching(/signature/i), expect.objectContaining({ asset: "install-tl-unx.tar.gz" }));
  });

  it("rejects a checksum signed by a key that is not the pinned one", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    const checksum = fixture.routes.get(`${INSTALL_TL_MIRROR}.sha512`) as string;
    fixture.routes.set(`${INSTALL_TL_MIRROR}.sha512.asc`, armoredSignature(Buffer.from(checksum), createTestSigningKey().privateKey));
    await expect(install()).rejects.toThrow(/signature/);
    expect(await fixture.calls()).toEqual([]);
  });

  it("rejects a checksum without its signature", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    fixture.routes.delete(`${INSTALL_TL_MIRROR}.sha512.asc`);
    await expect(install()).rejects.toThrow(/HTTP 404 from .*sha512\.asc/);
    expect(await fixture.calls()).toEqual([]);
  });

  it("rejects a signed checksum without a SHA-512", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    fixture.serveSignedChecksum("not found");
    await expect(install()).rejects.toThrow(/SHA-512/);
  });

  it("rejects a signed checksum of another file", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    const checksum = fixture.routes.get(`${INSTALL_TL_MIRROR}.sha512`) as string;
    fixture.serveSignedChecksum(checksum.replace("install-tl-unx.tar.gz", "install-tl.zip"));
    await expect(install()).rejects.toThrow(/install-tl\.zip/);
    expect(await fixture.calls()).toEqual([]);
  });

  it("fails with the exit code and output when install-tl fails, cleaning its staging", async () => {
    await fixture.serveInstallTl(2026, TLMGR);
    await import("node:fs/promises").then((fs) => fs.writeFile(fixture.callsFile, ""));
    await import("node:fs/promises").then((fs) => fs.chmod(fixture.callsFile, 0o444));
    await expect(install()).rejects.toThrow(/exited with code 1[\s\S]*EACCES/);
    expect(await readdir(fixture.texRoot)).toEqual([]);
  });
});
