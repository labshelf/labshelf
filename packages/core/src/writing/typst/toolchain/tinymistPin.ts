// Pins the Tinymist release LabShelf installs and the SHA-256 of its binary for each supported OS and architecture.
// CONTRACT: documents/contracts/managed-tools.md#tinymist

export const TINYMIST_VERSION = "0.15.10";

const RELEASE_URL = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}/`;

/** Release asset name and its SHA-256, keyed by `<process.platform>-<process.arch>`. */
const ASSETS: Readonly<Record<string, { name: string; sha256: string }>> = {
  "darwin-arm64": { name: "tinymist-darwin-arm64", sha256: "bb5bb435f83648f88f638c4050cd44f7222bd1be510c945df7d3ba9f75289225" },
  "darwin-x64": { name: "tinymist-darwin-x64", sha256: "f23df64659d0a538083346b45919580b9c777221dcefb8a895205d7253a34c3c" },
  "linux-arm64": { name: "tinymist-linux-arm64", sha256: "d731374db4c0da5e2ecb078de2e7c3517bafdcfe59047a2759c913ba19c6c872" },
  "linux-x64": { name: "tinymist-linux-x64", sha256: "b030af8966d2759949e33aa0fed518c1667431e1d551014034ccf3f94eac9746" },
  "win32-arm64": { name: "tinymist-win32-arm64.exe", sha256: "0f2504298cdacbac4ddd706a006f4b16434a068d91ff31a24c1536e2c25c1c78" },
  "win32-x64": { name: "tinymist-win32-x64.exe", sha256: "5c40fdbd7ba8aa411b74b552a4af08e927f9748874ed2e5e4144cc821cc305da" },
};

export interface TinymistAsset {
  version: string;
  url: string;
  sha256: string;
  /** The file name the binary has inside `<version>/`. */
  binaryName: string;
}

/** The pinned asset for this OS and architecture, or undefined when there is no managed Tinymist for it. */
export function tinymistAsset(platform: string, arch: string): TinymistAsset | undefined {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) { return undefined; }
  return {
    version: TINYMIST_VERSION,
    url: RELEASE_URL + asset.name,
    sha256: asset.sha256,
    binaryName: platform === "win32" ? "tinymist.exe" : "tinymist",
  };
}
