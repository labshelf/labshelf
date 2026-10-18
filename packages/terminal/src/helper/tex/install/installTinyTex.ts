// Installs the latest TinyTeX-1 for this user into <dataDir>/tex/tinytex, without admin rights.
import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { downloadVerified } from "@labshelf/core/node";

import { managedTexRoot } from "../texLayout.js";
import { runTexTool, TEX_MODULE } from "../runTexTool.js";
import type { TexInstallDeps, TexInstallRun } from "./installTypes.js";
import { singleTopDir } from "./singleTopDir.js";
import { latestTinyTexAsset, type TinyTexAsset } from "./tinyTexAsset.js";
import { withStagingDir } from "./stagingDir.js";

const execFileAsync = promisify(execFile);

async function download(deps: TexInstallDeps, asset: TinyTexAsset): Promise<Buffer> {
  await deps.logger.log("INFO", TEX_MODULE, "Downloading TinyTeX", { url: asset.url, sha256: asset.sha256 });
  try {
    const bytes = await downloadVerified(asset.url, asset.sha256, deps.fetchImpl);
    await deps.logger.log("INFO", TEX_MODULE, "TinyTeX checksum ok", { url: asset.url, bytes: bytes.length });
    return bytes;
  } catch (error) {
    await deps.logger.log("WARN", TEX_MODULE, "TinyTeX download failed its HTTP or checksum check", {
      url: asset.url, error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function unpack(deps: TexInstallDeps, archive: string, tree: string): Promise<void> {
  if (archive.endsWith(".exe")) {
    // PLATFORM: the Windows asset is a self-extracting archive that unpacks into its working directory.
    const outcome = await runTexTool({ executable: archive, args: ["-y"], cwd: tree, logger: deps.logger });
    if (outcome.code !== 0) {
      throw new Error(`TinyTeX self-extractor exited with code ${outcome.code}: ${outcome.output.slice(-2000)}`);
    }
    return;
  }
  // tar -xf detects the compression itself, so .tar.xz needs no xz flag.
  await deps.logger.log("INFO", TEX_MODULE, "Unpacking TinyTeX", { command: "tar", args: ["-xf", archive, "-C", tree] });
  await execFileAsync("tar", ["-xf", archive, "-C", tree]);
}

export async function installTinyTex(deps: TexInstallDeps, run: TexInstallRun): Promise<void> {
  run.onProgress(null);
  const asset = await latestTinyTexAsset(deps.fetchImpl, process.platform, process.arch);
  const bytes = await download(deps, asset);
  const target = managedTexRoot(run.dataDir, "tinytex");
  await withStagingDir(run.dataDir, "tinytex", async (staging) => {
    const tree = join(staging, "tree");
    const archive = join(tree, asset.name);
    await mkdir(tree);
    await writeFile(archive, bytes);
    await unpack(deps, archive, tree);
    await rm(archive, { force: true });
    const top = await singleTopDir(tree);
    // INVARIANT: the old tree goes only after the new one is verified and unpacked.
    await rm(target, { recursive: true, force: true });
    await rename(top, target);
  });
  await deps.logger.log("INFO", TEX_MODULE, "TinyTeX installed", { root: target, asset: asset.name });
  run.onProgress(1);
}
