// Prepares the LaTeX toolchain for callers outside the build queue and tells the user why none is ready.
import * as vscode from "vscode";

import { texLiveGuideUrl, type LatexToolchain, type ToolchainMissing } from "@labshelf/core";
import { ensureToolchain as ensureCoreToolchain } from "@labshelf/core/node";
import { executeSafely } from "../../../commands/index.js";
import type { ReadyProject } from "../../mainDocument.js";
import { vscodeToolchainPrompt, type ToolchainDeps } from "../toolchain/index.js";
import { reloadingProjects } from "./projectBuildDeps.js";

const OPEN_GUIDE = "Open TeX Live guide";

/** Explains a toolchain that could not be prepared; a declined prompt needs no message. */
export async function reportToolchainMissing(missing: ToolchainMissing): Promise<void> {
  if (missing.reason === "tectonic-unsupported") {
    const choice = await vscode.window.showErrorMessage(
      `Tectonic is not available for ${process.platform} ${process.arch}. Install TeX Live instead.`,
      OPEN_GUIDE,
    );
    if (choice === OPEN_GUIDE) { await vscode.env.openExternal(vscode.Uri.parse(texLiveGuideUrl(process.platform))); }
  } else if (missing.reason === "download-failed") {
    await vscode.window.showErrorMessage(`Tectonic could not be installed: ${missing.message}`);
  }
}

/** The program that builds the project, asking the user on the first build; undefined when nothing is ready to run. */
export async function ensureToolchain(deps: ToolchainDeps, project: ReadyProject): Promise<LatexToolchain | undefined> {
  const session = deps.host.current();
  if (!session) { return undefined; }
  let toolchain: LatexToolchain | undefined;
  await executeSafely(session.logger, "labshelf.writing.ensureToolchain", async () => {
    const result = await ensureCoreToolchain(project, {
      logger: session.logger,
      toolchain: vscodeToolchainPrompt,
      storageDir: deps.storageDir,
      projects: reloadingProjects(deps.projects),
    });
    if ("executable" in result) { toolchain = result; } else { await reportToolchainMissing(result); }
  });
  return toolchain;
}
