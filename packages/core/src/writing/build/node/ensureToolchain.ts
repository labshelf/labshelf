// Finds the project's LaTeX toolchain in the managed TeX, offering to install TeX when none is found.
import type { ILogger } from "../../../ports/index.js";
import type { LatexToolchain, TexInstallKind } from "../../../latex/toolchain/index.js";
import type { ManagedTexProvider } from "../../../latex/toolchain/node/managedTex/index.js";
import type { ProjectEntry } from "../../project/index.js";
import type { ToolchainMissing } from "../projectBuildResult.js";
import type { TexSetupAsk } from "../askTexToolchain.js";
import { formatError } from "../../../errors/index.js";

const MODULE = "writing/build";

export interface ToolchainDeps {
  logger: ILogger;
  prompt: TexSetupAsk;
  tex: ManagedTexProvider;
}

const INSTALL_TITLES: Readonly<Record<TexInstallKind, string>> = {
  tinytex: "Installing TinyTeX",
  texlive: "Installing TeX Live",
};

async function install(deps: ToolchainDeps, kind: TexInstallKind, context: Record<string, unknown>): Promise<ToolchainMissing | undefined> {
  await deps.logger.log("INFO", MODULE, "Installing TeX", { ...context, kind });
  try {
    await deps.prompt.progress(INSTALL_TITLES[kind], (report) =>
      deps.tex.install(kind, (fraction) => report(fraction === null ? "" : `${Math.round(fraction * 100)}%`)));
  } catch (error) {
    await deps.logger.error(MODULE, error, { ...context, kind, action: "install-tex" });
    return { status: "toolchain-missing", reason: "install-failed", message: formatError(error) };
  }
  await deps.logger.log("INFO", MODULE, "Installed TeX", { ...context, kind });
  return undefined;
}

/** The program that builds the project; when no TeX is found, asks which one to install and installs it. */
export async function ensureToolchain(
  project: Extract<ProjectEntry, { kind: "ready" }>,
  deps: ToolchainDeps,
): Promise<LatexToolchain | ToolchainMissing> {
  const engine = project.settings.engine ?? "pdflatex";
  const context = { folder: project.folder, engine };
  const found = await deps.tex.resolve(engine);
  if (found !== "missing") { return found; }
  await deps.logger.log("WARN", MODULE, "No TeX installation found; asking which to install", context);
  const kind = await deps.prompt.chooseInstall();
  if (!kind) {
    await deps.logger.log("INFO", MODULE, "The user declined the TeX install", context);
    return { status: "toolchain-missing", reason: "declined" };
  }
  const failed = await install(deps, kind, context);
  if (failed) { return failed; }
  const installed = await deps.tex.resolve(engine);
  if (installed !== "missing") { return installed; }
  await deps.logger.log("WARN", MODULE, "TeX is still missing after the install", { ...context, kind });
  return { status: "toolchain-missing", reason: "install-failed", message: `The ${kind} install finished but no TeX was found` };
}
