// Installs a full TeX Live for this user into <texRoot>/texlive with install-tl, without admin rights.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { extractArchive, type FetchLike } from "../index.js";

import { managedTexRoot } from "./texLayout.js";
import { texLiveProfile } from "./texLiveProfile.js";
import { runTexTool, TEX_MODULE } from "./runTexTool.js";
import type { TexInstallDeps, TexInstallRun } from "./texInstall.js";
import { singleTopDir } from "./unpackedDir.js";
import { withStagingDir } from "./stagingDir.js";
import type { ILogger } from "../../../../ports/index.js";
import { verifyDetachedSignature } from "../verifySignature.js";
import { TEX_LIVE_SIGNING_KEY } from "./texLiveKeyring.js";

const TLNET = "https://mirror.ctan.org/systems/texlive/tlnet/";
const SHA512_LINE = /^([0-9a-f]{128})\s+\*?(\S+)$/im;

interface TexLiveInstaller {
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

async function downloadTexLiveInstaller(fetchImpl: FetchLike, logger: ILogger, platform: string): Promise<TexLiveInstaller> {
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

function installTlCommand(dir: string, profile: string): { executable: string; args: string[] } {
  const args = ["--no-interaction", "--profile", profile];
  // PLATFORM: on Windows install-tl starts from its .bat and needs -non-admin to stay per-user.
  return process.platform === "win32"
    ? { executable: join(dir, "install-tl-windows.bat"), args: [...args, "-non-admin"] }
    : { executable: join(dir, "install-tl"), args };
}

export async function installTexLive(deps: TexInstallDeps, run: TexInstallRun): Promise<void> {
  run.onProgress(null);
  const root = managedTexRoot(run.texRoot, "texlive");
  const installer = await downloadTexLiveInstaller(deps.fetchImpl, deps.logger, process.platform);
  await withStagingDir(run.texRoot, "texlive", async (staging) => {
    const tree = join(staging, "tree");
    await mkdir(tree);
    const archive = join(staging, installer.name);
    await writeFile(archive, installer.bytes);
    await extractArchive(archive, installer.kind, tree);
    const profile = join(staging, "texlive.profile");
    await writeFile(profile, texLiveProfile(run.texRoot));
    const command = installTlCommand(await singleTopDir(tree), profile);
    // INVARIANT: a texlive tree exists only after install-tl succeeded, because its presence means "installed".
    await rm(root, { recursive: true, force: true });
    const outcome = await runTexTool({ ...command, cwd: staging, logger: deps.logger, onProgress: run.onProgress });
    if (outcome.code !== 0) {
      await rm(root, { recursive: true, force: true });
      throw new Error(`install-tl exited with code ${outcome.code}: ${outcome.output.slice(-2000)}`);
    }
  });
  await deps.logger.log("INFO", TEX_MODULE, "TeX Live installed", { root });
  run.onProgress(1);
}
