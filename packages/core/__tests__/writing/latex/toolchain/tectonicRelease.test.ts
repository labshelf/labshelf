/** Verifies the pinned Tectonic asset chosen for each supported platform. */
import { TECTONIC_VERSION, tectonicAsset, texLiveGuideUrl } from "../../../../src/writing/latex/toolchain/index";

describe("tectonicAsset", () => {
  it.each([
    ["darwin", "arm64", "aarch64-apple-darwin.tar.gz", "tar.gz", "tectonic"],
    ["darwin", "x64", "x86_64-apple-darwin.tar.gz", "tar.gz", "tectonic"],
    ["linux", "x64", "x86_64-unknown-linux-musl.tar.gz", "tar.gz", "tectonic"],
    ["linux", "arm64", "aarch64-unknown-linux-musl.tar.gz", "tar.gz", "tectonic"],
    ["win32", "x64", "x86_64-pc-windows-msvc.zip", "zip", "tectonic.exe"],
  ])("maps %s %s to the release asset", (platform, arch, suffix, archive, binary) => {
    const asset = tectonicAsset(platform, arch);
    expect(asset?.url).toBe(
      `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${suffix}`,
    );
    expect(asset?.archive).toBe(archive);
    expect(asset?.binary).toBe(binary);
    expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset?.sizeMb).toBeGreaterThan(0);
  });

  it.each([["win32", "arm64"], ["freebsd", "x64"], ["linux", "ia32"]])("returns undefined for %s %s", (platform, arch) => {
    expect(tectonicAsset(platform, arch)).toBeUndefined();
  });
});

describe("texLiveGuideUrl", () => {
  it("points each operating system to its guide", () => {
    expect(texLiveGuideUrl("darwin")).toBe("https://www.tug.org/mactex/");
    expect(texLiveGuideUrl("win32")).toBe("https://www.tug.org/texlive/windows.html");
    expect(texLiveGuideUrl("linux")).toBe("https://www.tug.org/texlive/quickinstall.html");
  });
});
