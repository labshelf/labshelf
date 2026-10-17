// Chooses and prepares the LaTeX toolchain of a project: the first-run pick, TeX Live detection and the Tectonic fallback.
import type { ILogger } from "../../../ports/index.js";
import { tectonicAsset, type LatexToolchain } from "../../latex/toolchain/index.js";
import { findExecutable } from "../../latex/toolchain/node/index.js";
import type { LatexEngine, ProjectEntry } from "../../project/index.js";
import type { ProjectDataPort } from "../../projectData/index.js";
import type { ToolchainMissing } from "../projectBuildResult.js";
import type { ToolchainPrompt } from "../toolchainPrompt.js";
import { tectonicToolchain } from "./tectonicToolchain.js";

const MODULE = "writing/build";

export interface ToolchainDeps {
  logger: ILogger;
  toolchain: ToolchainPrompt;
  /** Tectonic is installed under this folder. */
  storageDir: string;
  projects: Pick<ProjectDataPort, "updateProjectSettings">;
}

async function storeEngine(deps: ToolchainDeps, folder: string, engine: LatexEngine): Promise<void> {
  await deps.projects.updateProjectSettings(folder, { engine });
  await deps.logger.log("INFO", MODULE, "Stored the project's LaTeX engine", { folder, engine });
}

/** The program that builds the project, asking the user on the first build. */
export async function ensureToolchain(
  project: Extract<ProjectEntry, { kind: "ready" }>,
  deps: ToolchainDeps,
): Promise<LatexToolchain | ToolchainMissing> {
  let engine = project.settings.engine;
  if (!engine) {
    const texLiveInstalled = (await findExecutable("latexmk")) !== undefined;
    engine = await deps.toolchain.pickEngine({ texLiveInstalled, tectonic: tectonicAsset(process.platform, process.arch) });
    if (!engine) { return { status: "toolchain-missing", reason: "declined" }; }
    await storeEngine(deps, project.folder, engine);
  }
  if (engine === "tectonic") { return tectonicToolchain(deps.storageDir, deps.toolchain, deps.logger); }
  const latexmk = await findExecutable("latexmk");
  if (latexmk) { return { engine, executable: latexmk }; }
  await deps.logger.log("WARN", MODULE, "latexmk is not on PATH", { folder: project.folder, engine });
  if (!(await deps.toolchain.offerTectonic(engine))) { return { status: "toolchain-missing", reason: "tex-live-missing" }; }
  await storeEngine(deps, project.folder, "tectonic");
  return tectonicToolchain(deps.storageDir, deps.toolchain, deps.logger);
}
