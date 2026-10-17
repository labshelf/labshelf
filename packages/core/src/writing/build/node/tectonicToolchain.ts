// Returns the installed Tectonic, downloading the pinned release once the user agrees.
import type { ILogger } from "../../../ports/index.js";
import { tectonicAsset, type LatexToolchain } from "../../latex/toolchain/index.js";
import { installedTectonic, installTectonic } from "../../latex/toolchain/node/index.js";
import type { ToolchainMissing } from "../projectBuildResult.js";
import type { ToolchainPrompt } from "../toolchainPrompt.js";

const MODULE = "writing/build";

export async function tectonicToolchain(storageDir: string, prompt: ToolchainPrompt, logger: ILogger): Promise<LatexToolchain | ToolchainMissing> {
  const installed = await installedTectonic(storageDir);
  if (installed) { return { engine: "tectonic", executable: installed }; }
  const asset = tectonicAsset(process.platform, process.arch);
  if (!asset) {
    await logger.log("WARN", MODULE, "Tectonic has no release for this system", { platform: process.platform, arch: process.arch });
    return { status: "toolchain-missing", reason: "tectonic-unsupported" };
  }
  if (!(await prompt.confirmTectonicDownload(asset))) { return { status: "toolchain-missing", reason: "declined" }; }
  let used: AbortSignal | undefined;
  try {
    const executable = await prompt.downloading((signal) => {
      used = signal;
      return installTectonic(storageDir, { logger, signal });
    });
    return { engine: "tectonic", executable };
  } catch (error) {
    // A cancelled download is the user's choice, not a failure to report.
    if (used?.aborted) {
      await logger.log("INFO", MODULE, "Tectonic download cancelled", { storageDir });
      return { status: "toolchain-missing", reason: "declined" };
    }
    await logger.error(MODULE, error, { action: "install-tectonic", storageDir });
    return { status: "toolchain-missing", reason: "download-failed", message: error instanceof Error ? error.message : String(error) };
  }
}
