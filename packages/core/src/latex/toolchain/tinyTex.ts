// Pins the TinyTeX-1 release LabShelf installs and the SHA-256 of its archive for each supported OS and architecture.
const TINYTEX_VERSION = "2026.10";

const RELEASE_URL = `https://github.com/rstudio/tinytex-releases/releases/download/v${TINYTEX_VERSION}/`;

const MAC = { name: `TinyTeX-1-darwin-v${TINYTEX_VERSION}.tar.xz`, sha256: "e40c294efae81026d8cc8d12c09d2dd456d268efe7fe092410478bc1973fd40f" };
const WINDOWS = { name: `TinyTeX-1-windows-v${TINYTEX_VERSION}.exe`, sha256: "36c329c644683d981a668419d13c8804696e2816ae4d287ad755788fee231a31" };

/** Release asset name and its SHA-256, keyed by `<process.platform>-<process.arch>`. */
const ASSETS: Readonly<Record<string, { name: string; sha256: string }>> = {
  "darwin-arm64": MAC,
  "darwin-x64": MAC,
  "linux-x64": { name: `TinyTeX-1-linux-x86_64-v${TINYTEX_VERSION}.tar.xz`, sha256: "4d519d6236ee6798e3ec0d8e2093d1fda01aeb267aa22c2a5586d76bcfce6566" },
  "linux-arm64": { name: `TinyTeX-1-linux-arm64-v${TINYTEX_VERSION}.tar.xz`, sha256: "1bc5465c7a7c6f13e13c1b54a52147577eb3f389033af0444bc097698eb6653f" },
  "win32-x64": WINDOWS,
  "win32-arm64": WINDOWS,
};

export interface TinyTexFile {
  version: string;
  name: string;
  url: string;
  sha256: string;
}

/** The pinned asset for this OS and architecture, or undefined when TinyTeX has no build for it. */
export function findTinyTexFile(platform: string, arch: string): TinyTexFile | undefined {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) { return undefined; }
  return { version: TINYTEX_VERSION, name: asset.name, url: RELEASE_URL + asset.name, sha256: asset.sha256 };
}
