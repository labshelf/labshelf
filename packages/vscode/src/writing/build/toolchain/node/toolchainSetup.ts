// Chooses and prepares the LaTeX toolchain of a project: the first-run pick, TeX Live detection and the Tectonic fallback.
import * as vscode from "vscode";

import {
  engineLabel, tectonicAsset, texLiveGuideUrl, type LatexEngine, type LatexToolchain,
} from "@labshelf/core";
import { findExecutable } from "@labshelf/core/node";
import type { ReadyProject } from "../../../mainDocument.js";
import { tectonicToolchain } from "./tectonicSetup.js";
import { saveEngine, type ToolchainDeps } from "../toolchainDeps.js";

const OPEN_GUIDE = "Open install guide";
const USE_TECTONIC = "Use Tectonic";

type EnginePick = vscode.QuickPickItem & { engine: LatexEngine };

async function pickEngine(hasLatexmk: boolean): Promise<LatexEngine | undefined> {
  const asset = tectonicAsset(process.platform, process.arch);
  const tectonic: EnginePick = {
    label: engineLabel("tectonic"),
    description: "recommended",
    detail: asset
      ? `Downloads about ${asset.sizeMb} MB once and fetches packages as documents need them.`
      : "Not available on this system.",
    engine: "tectonic",
  };
  const texLive: EnginePick = {
    label: "TeX Live (latexmk)",
    detail: hasLatexmk ? "Uses the TeX Live installed on this computer." : "TeX Live is not installed.",
    engine: "pdflatex",
  };
  const picked = await vscode.window.showQuickPick<EnginePick>(hasLatexmk ? [texLive, tectonic] : [tectonic, texLive], {
    placeHolder: "Choose how LabShelf builds LaTeX projects",
  });
  return picked?.engine;
}

async function texLiveToolchain(
  deps: ToolchainDeps,
  project: ReadyProject,
  engine: Exclude<LatexEngine, "tectonic">,
): Promise<LatexToolchain | undefined> {
  const latexmk = await findExecutable("latexmk");
  if (latexmk) { return { engine, executable: latexmk }; }
  const choice = await vscode.window.showErrorMessage(
    `${engineLabel(engine)} needs TeX Live, which is not installed. Tectonic runs only XeLaTeX.`,
    OPEN_GUIDE,
    USE_TECTONIC,
  );
  if (choice === OPEN_GUIDE) {
    await vscode.env.openExternal(vscode.Uri.parse(texLiveGuideUrl(process.platform)));
  } else if (choice === USE_TECTONIC && (await saveEngine(deps, project, "tectonic"))) {
    return ensureToolchain(deps, { ...project, settings: { ...project.settings, engine: "tectonic" } });
  }
  return undefined;
}

/** The program that builds the project, asking the user on the first build; undefined when nothing is ready to run. */
export async function ensureToolchain(deps: ToolchainDeps, project: ReadyProject): Promise<LatexToolchain | undefined> {
  const session = deps.host.current();
  if (!session) { return undefined; }
  let engine = project.settings.engine;
  if (!engine) {
    engine = await pickEngine((await findExecutable("latexmk")) !== undefined);
    if (!engine || !(await saveEngine(deps, project, engine))) { return undefined; }
  }
  return engine === "tectonic" ? tectonicToolchain(deps.storageDir, session) : texLiveToolchain(deps, project, engine);
}
