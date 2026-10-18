// Downloads the TeX Live network installer from a CTAN mirror and checks it against that mirror's signed SHA-512.
import { createHash } from "node:crypto";

import type { ILogger } from "../../../../../../ports/index.js";
import type { FetchLike } from "../../index.js";

import { verifyDetachedSignature } from "../../openPgp/index.js";
import { TEX_MODULE } from "../runTexTool.js";
import { TEX_LIVE_SIGNING_KEY } from "./texLiveKey.js";

const TLNET = "https://mirror.ctan.org/systems/texlive/tlnet/";
const SHA512_LINE = /^([0-9a-f]{128})\s+\*?(\S+)$/im;

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
async function expectedSha512(fetchImpl: FetchLike, logger: ILogger, mirrorUrl: string, asset: string): Promise<string> {
  const checksumUrl = `${mirrorUrl}.sha512`;
  const checksum = Buffer.from(await (await fetchOk(fetchImpl, checksumUrl)).arrayBuffer());
  const signature = await (await fetchOk(fetchImpl, `${checksumUrl}.asc`)).text();
  if (!verifyDetachedSignature(checksum, signature, TEX_LIVE_SIGNING_KEY)) {
    await logger.log("WARN", TEX_MODULE, "TeX Live checksum signature does not match the pinned key", { asset, url: checksumUrl });
    throw new Error(`The OpenPGP signature of ${checksumUrl} does not match the pinned TeX Live key`);
  }
  const match = SHA512_LINE.exec(checksum.toString("utf8"));
  if (!match?.[1]) { throw new Error(`No SHA-512 found in ${checksumUrl}`); }
  if (match[2] !== asset) { throw new Error(`${checksumUrl} is the checksum of ${match[2]}, not ${asset}`); }
  return match[1].toLowerCase();
}

export async function downloadTexLiveInstaller(fetchImpl: FetchLike, logger: ILogger, platform: string): Promise<TexLiveInstaller> {
  const { name, kind } = texLiveInstallerName(platform);
  const url = `${TLNET}${name}`;
  await logger.log("INFO", TEX_MODULE, "Downloading the TeX Live installer", { url });
  const response = await fetchOk(fetchImpl, url);
  const mirrorUrl = response.url || url;
  if (!mirrorUrl.startsWith("https://")) { throw new Error(`CTAN redirected the TeX Live installer to a non-HTTPS mirror: ${mirrorUrl}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = await expectedSha512(fetchImpl, logger, mirrorUrl, name);
  const actual = createHash("sha512").update(bytes).digest("hex");
  if (actual !== expected) {
    await logger.log("WARN", TEX_MODULE, "TeX Live installer checksum mismatch", { asset: name, url: mirrorUrl, expected, actual });
    throw new Error(`Checksum mismatch for ${mirrorUrl}: expected ${expected}, got ${actual}`);
  }
  await logger.log("INFO", TEX_MODULE, "TeX Live installer checksum ok", { url: mirrorUrl, bytes: bytes.length });
  return { name, kind, bytes };
}
