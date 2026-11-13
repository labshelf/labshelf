// Pins the managed pix2tex: its version, the hash-pinned requirements file per platform with the download size, and the model weights by SHA-256.
// CONTRACT: documents/contracts/managed-tools.md#pix2tex

export type Pix2texPlatform = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'linux-x64' | 'linux-arm64';

export interface Pix2texPin {
  version: string;
  /** Per platform the requirements file under `equations/node/pix2tex-requirements/` and the approximate total download (wheels plus weights) in MB; null where torch has no CPU wheel set. */
  platforms: Record<Pix2texPlatform, { requirements: string; downloadMb: number } | null>;
  weights: Array<{ file: string; url: string; sha256: string }>;
}

const WEIGHTS_RELEASE = "https://github.com/lukas-blecher/LaTeX-OCR/releases/download/v0.0.1";

// INVARIANT: darwin-x64 stays on torch 2.2.2, the last torch with x86_64 macOS wheels, and so on numpy<2, which that torch was built against.
export const PIX2TEX_PIN: Pix2texPin = {
  version: "0.1.4",
  platforms: {
    "darwin-arm64": { requirements: "darwin-arm64.txt", downloadMb: 350 },
    "darwin-x64": { requirements: "darwin-x64.txt", downloadMb: 440 },
    "win32-x64": { requirements: "win32-x64.txt", downloadMb: 400 },
    "linux-x64": { requirements: "linux-x64.txt", downloadMb: 510 },
    "linux-arm64": { requirements: "linux-arm64.txt", downloadMb: 445 },
  },
  weights: [
    { file: "weights.pth", url: `${WEIGHTS_RELEASE}/weights.pth`, sha256: "a63d9141c53d266cb682fb5a8bd83bd5cbe283145e0e78ebdc0f895195a1dfaa" },
    { file: "image_resizer.pth", url: `${WEIGHTS_RELEASE}/image_resizer.pth`, sha256: "1c3820659985ad142b526490bb25c23d977176ac2073591b3bddada692718458" },
  ],
};

const PLATFORMS: readonly Pix2texPlatform[] = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64", "linux-arm64"];

export function pix2texPlatform(platform: string, arch: string): Pix2texPlatform | undefined {
  const key = `${platform}-${arch}`;
  return PLATFORMS.find((candidate) => candidate === key);
}
