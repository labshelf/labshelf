// Picks this platform's TinyTeX-1 asset from the latest GitHub release and checks its URL and digest.
import type { FetchLike } from "../../index.js";

const LATEST_RELEASE = "https://api.github.com/repos/rstudio/tinytex-releases/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/rstudio/tinytex-releases/releases/download/";
const ASSET = /^TinyTeX-1-(darwin|linux-x86_64|linux-arm64|windows)-v[\d.]+\.(tar\.xz|exe)$/;
const DIGEST = /^sha256:([0-9a-f]{64})$/;

export interface TinyTexAsset {
  name: string;
  url: string;
  sha256: string;
}

interface ReleaseAsset { name?: unknown; digest?: unknown; browser_download_url?: unknown }

function tinyTexPlatform(platform: string, arch: string): string {
  if (platform === "darwin") { return "darwin"; }
  if (platform === "win32") { return "windows"; }
  if (platform === "linux" && arch === "x64") { return "linux-x86_64"; }
  if (platform === "linux" && arch === "arm64") { return "linux-arm64"; }
  throw new Error(`TinyTeX has no build for ${platform}-${arch}`);
}

async function releaseAssets(fetchImpl: FetchLike): Promise<ReleaseAsset[]> {
  const response = await fetchImpl(LATEST_RELEASE);
  if (!response.ok) { throw new Error(`TinyTeX release lookup failed with HTTP ${response.status} from ${LATEST_RELEASE}`); }
  const release: unknown = await response.json();
  const assets = (release as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) { throw new Error(`TinyTeX release from ${LATEST_RELEASE} has no asset list`); }
  return assets as ReleaseAsset[];
}

// TRAP: the release JSON is untrusted input; the URL and digest are checked before anything is downloaded.
export async function latestTinyTexAsset(fetchImpl: FetchLike, platform: string, arch: string): Promise<TinyTexAsset> {
  const wanted = tinyTexPlatform(platform, arch);
  const asset = (await releaseAssets(fetchImpl)).find((candidate) =>
    typeof candidate.name === "string" && ASSET.exec(candidate.name)?.[1] === wanted);
  if (!asset || typeof asset.name !== "string") { throw new Error(`The latest TinyTeX release has no TinyTeX-1 asset for ${wanted}`); }
  const url = String(asset.browser_download_url);
  if (!url.startsWith(DOWNLOAD_PREFIX) || !url.endsWith(`/${asset.name}`)) {
    throw new Error(`TinyTeX asset ${asset.name} points outside ${DOWNLOAD_PREFIX}: ${url}`);
  }
  const digest = DIGEST.exec(String(asset.digest))?.[1];
  if (!digest) { throw new Error(`TinyTeX asset ${asset.name} has no sha256 digest: ${String(asset.digest)}`); }
  return { name: asset.name, url, sha256: digest };
}
