// Downloads the TeX Live network installer from a CTAN mirror and checks it against that mirror's SHA-512.
import { createHash } from "node:crypto";

import type { ILogger } from "../../../../../../ports/index.js";
import type { FetchLike } from "../../index.js";

import { TEX_MODULE } from "../runTexTool.js";

const TLNET = "https://mirror.ctan.org/systems/texlive/tlnet/";
const SHA512 = /^([0-9a-f]{128})\b/i;

export interface TexLiveInstaller {
  /** The archive file name, e.g. `install-tl-unx.tar.gz`. */
  name: string;
  kind: "tar.gz" | "zip";
  bytes: Buffer;
}

function texLiveInstallerName(platform: string): Pick<TexLiveInstaller, "name" | "kind"> {
  return platform === "win32" ? { name: "install-tl.zip", kind: "zip" } : { name: "install-tl-unx.tar.gz", kind: "tar.gz" };
}

async function fetchOk(fetchImpl: FetchLike, url: string): Promise<Response> {
  const response = await fetchImpl(url);
  if (!response.ok) { throw new Error(`Download failed with HTTP ${response.status} from ${url}`); }
  return response;
}

// TRAP: mirror.ctan.org redirects to a random mirror; the checksum must come from the mirror that served the bytes.
async function expectedSha512(fetchImpl: FetchLike, mirrorUrl: string): Promise<string> {
  const checksumUrl = `${mirrorUrl}.sha512`;
  const digest = SHA512.exec((await (await fetchOk(fetchImpl, checksumUrl)).text()).trim())?.[1];
  if (!digest) { throw new Error(`No SHA-512 found in ${checksumUrl}`); }
  return digest.toLowerCase();
}

export async function downloadTexLiveInstaller(fetchImpl: FetchLike, logger: ILogger, platform: string): Promise<TexLiveInstaller> {
  const { name, kind } = texLiveInstallerName(platform);
  const url = `${TLNET}${name}`;
  await logger.log("INFO", TEX_MODULE, "Downloading the TeX Live installer", { url });
  const response = await fetchOk(fetchImpl, url);
  const mirrorUrl = response.url || url;
  if (!mirrorUrl.startsWith("https://")) { throw new Error(`CTAN redirected the TeX Live installer to a non-HTTPS mirror: ${mirrorUrl}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = await expectedSha512(fetchImpl, mirrorUrl);
  const actual = createHash("sha512").update(bytes).digest("hex");
  if (actual !== expected) {
    await logger.log("WARN", TEX_MODULE, "TeX Live installer checksum mismatch", { url: mirrorUrl, expected, actual });
    throw new Error(`Checksum mismatch for ${mirrorUrl}: expected ${expected}, got ${actual}`);
  }
  await logger.log("INFO", TEX_MODULE, "TeX Live installer checksum ok", { url: mirrorUrl, bytes: bytes.length });
  return { name, kind, bytes };
}
