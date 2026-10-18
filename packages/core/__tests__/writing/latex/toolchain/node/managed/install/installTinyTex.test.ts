import { existsSync } from "node:fs";
import { join } from "node:path";

import { installTinyTex } from "../../../../../../../src/writing/latex/toolchain/node/managed/install/index";
import { asLogger, createTexFixture, TINYTEX_API, type TexFixture } from "../fakeTex";

const TLMGR = { rollover: false, installed: [] };

function pretend(property: "platform" | "arch", value: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, property);
  Object.defineProperty(process, property, { value, configurable: true });
  return () => { if (original) { Object.defineProperty(process, property, original); } };
}

describe("installTinyTex", () => {
  let fixture: TexFixture;
  let restore: Array<() => void>;
  beforeEach(async () => {
    fixture = await createTexFixture();
    // The fixture serves the linux-x86_64 asset with a real digest; the darwin one has a zero digest.
    restore = [pretend("platform", "linux"), pretend("arch", "x64")];
  });
  afterEach(async () => {
    restore.forEach((undo) => undo());
    await fixture.cleanup();
  });

  const install = (progress: Array<number | null> = []) => installTinyTex(
    { fetchImpl: fixture.fetchImpl, logger: asLogger(fixture.logger) },
    { texRoot: fixture.texRoot, onProgress: (fraction) => { progress.push(fraction); } },
  );

  it("unpacks the release archive into tex/tinytex and leaves no staging behind", async () => {
    await fixture.serveTinyTex(2026, TLMGR);
    const progress: Array<number | null> = [];
    await install(progress);
    expect(existsSync(join(fixture.texRoot, "tinytex", "bin", "x86_64-linux", "tlmgr"))).toBe(true);
    expect(existsSync(join(fixture.texRoot, "tinytex", "release-texlive.txt"))).toBe(true);
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(fixture.texRoot)).toEqual(["tinytex"]);
    expect(progress).toContain(null);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("replaces an older tex/tinytex", async () => {
    await fixture.serveTinyTex(2025, TLMGR);
    await install();
    await fixture.serveTinyTex(2026, TLMGR);
    await install();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(fixture.texRoot, "tinytex", "release-texlive.txt"), "utf8")).toContain("2026");
  });

  it("rejects a checksum mismatch and leaves no tex/tinytex", async () => {
    await fixture.serveTinyTex(2026, TLMGR, Buffer.from("something else"));
    await expect(install()).rejects.toThrow(/Checksum mismatch/);
    expect(existsSync(join(fixture.texRoot, "tinytex"))).toBe(false);
    expect(fixture.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.stringMatching(/checksum/i), expect.anything());
  });

  it("rejects an asset outside the TinyTeX releases", async () => {
    await fixture.serveTinyTex(2026, TLMGR);
    const release = JSON.parse(fixture.routes.get(TINYTEX_API) as string);
    release.assets[1].browser_download_url = "https://evil.example.org/TinyTeX-1-linux-x86_64-v2026.10.tar.xz";
    fixture.routes.set(TINYTEX_API, JSON.stringify(release));
    await expect(install()).rejects.toThrow(/evil\.example\.org/);
    expect(existsSync(join(fixture.texRoot, "tinytex"))).toBe(false);
  });

  it("rejects an asset whose digest is not a sha256", async () => {
    await fixture.serveTinyTex(2026, TLMGR);
    const release = JSON.parse(fixture.routes.get(TINYTEX_API) as string);
    release.assets[1].digest = "md5:abc";
    fixture.routes.set(TINYTEX_API, JSON.stringify(release));
    await expect(install()).rejects.toThrow(/digest/);
  });

  it("rejects a release without an asset for this platform", async () => {
    await fixture.serveTinyTex(2026, TLMGR);
    restore.push(pretend("arch", "ia32"));
    await expect(install()).rejects.toThrow(/linux/);
  });
});
