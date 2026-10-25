// Prepares the LaTeX toolchain for callers outside the build queue and tells the user why none is ready.
import * as vscode from "vscode";

import { texLiveGuideUrl, type LatexToolchain, type ToolchainMissing } from "@labshelf/core";
import { ensureToolchain as ensureCoreToolchain } from "@labshelf/core/node";
import { executeSafely } from "../../../command/index.js";
import type { ReadyProject } from "../../buildRootDocument.js";
import { vscodeToolchainPrompt, type ToolchainDeps } from "../toolchain/index.js";

const OPEN_GUIDE = "Open install guide";

/** Explains a toolchain that could not be prepared; a declined prompt needs no message because the user chose it. */
export async function reportToolchainMissing(missing: ToolchainMissing): Promise<void> {
  if (missing.reason !== "install-failed") { return; }
  const choice = await vscode.window.showErrorMessage(`LaTeX could not be installed: ${missing.message}`, OPEN_GUIDE);
  if (choice === OPEN_GUIDE) { await vscode.env.openExternal(vscode.Uri.parse(texLiveGuideUrl(process.platform))); }
}

/** The program that builds the project, asking the user on the first build; undefined when nothing is ready to run. */
export async function ensureToolchain(deps: ToolchainDeps, project: ReadyProject): Promise<LatexToolchain | undefined> {
  const session = deps.host.current();
  if (!session) { return undefined; }
  let toolchain: LatexToolchain | undefined;
  await executeSafely(session.logger, "labshelf.writing.ensureToolchain", async () => {
    const result = await ensureCoreToolchain(project, {
      logger: session.logger,
      prompt: vscodeToolchainPrompt(),
      tex: deps.tex,
    });
    if ("executable" in result) { toolchain = result; } else { await reportToolchainMissing(result); }
  });
  return toolchain;
}
