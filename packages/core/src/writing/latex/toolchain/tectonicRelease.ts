// Names the pinned Tectonic release asset, its checksum and its size for a platform.

export const TECTONIC_VERSION = "0.17.0";

export interface TectonicAsset {
  url: string;
  /** SHA-256 of the downloaded archive, lowercase hex. */
  sha256: string;
  sizeMb: number;
  archive: "tar.gz" | "zip";
  /** File name of the executable inside the archive. */
  binary: string;
}

const RELEASE_BASE = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}`;

interface AssetSpec { suffix: string; sha256: string; sizeMb: number }

const ASSETS: Readonly<Record<string, AssetSpec>> = {
  "darwin-arm64": {
    suffix: "aarch64-apple-darwin.tar.gz", sizeMb: 22,
    sha256: "a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667",
  },
  "darwin-x64": {
    suffix: "x86_64-apple-darwin.tar.gz", sizeMb: 22,
    sha256: "7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80",
  },
  "linux-x64": {
    suffix: "x86_64-unknown-linux-musl.tar.gz", sizeMb: 10,
    sha256: "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7",
  },
  "linux-arm64": {
    suffix: "aarch64-unknown-linux-musl.tar.gz", sizeMb: 10,
    sha256: "b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8",
  },
  "win32-x64": {
    suffix: "x86_64-pc-windows-msvc.zip", sizeMb: 21,
    sha256: "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f",
  },
};

/** The release asset for a Node `process.platform` and `process.arch`; undefined where Tectonic publishes no build. */
export function tectonicAsset(platform: string, arch: string): TectonicAsset | undefined {
  const spec = ASSETS[`${platform}-${arch}`];
  if (!spec) { return undefined; }
  return {
    url: `${RELEASE_BASE}/tectonic-${TECTONIC_VERSION}-${spec.suffix}`,
    sha256: spec.sha256,
    sizeMb: spec.sizeMb,
    archive: spec.suffix.endsWith(".zip") ? "zip" : "tar.gz",
    binary: platform === "win32" ? "tectonic.exe" : "tectonic",
  };
}
