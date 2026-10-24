// Installs a full TeX Live for this user into <texRoot>/texlive with install-tl, without admin rights.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractArchive } from "../index.js";

import { managedTexRoot } from "./texLayout.js";
import { texLiveProfile } from "./texLiveProfile.js";
import { runTexTool, TEX_MODULE } from "./runTexTool.js";
import type { TexInstallDeps, TexInstallRun } from "./texInstall.js";
import { singleTopDir } from "./unpackedDir.js";
import { withStagingDir } from "./stagingDir.js";
import { downloadTexLiveInstaller } from "./texLiveInstaller.js";

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
