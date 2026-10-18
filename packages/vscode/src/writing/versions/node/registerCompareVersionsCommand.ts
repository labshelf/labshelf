// Registers Compare Versions: shows what changed between two versions, or between a version and the current build.
import * as path from "node:path";
import * as vscode from "vscode";

import { listVersions, type ILogger, type PdfjsLoader, type ProjectEntry } from "@labshelf/core";
import { buildMarkedUpDiff, comparePdfs, findExecutable, nodeProjectReadContext, projectBuildDir } from "@labshelf/core/node";
import { executeSafely } from "../../../commands/index.js";
import type { ReaderPanelDeps } from "../../../pdf-viewer/index.js";
import { activeProject } from "../../build/index.js";
import { ensureToolchain } from "../../build/node/index.js";
import type { ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import type { ProjectBuilders } from "../../build/index.js";
import { buildCurrentPdf } from "../buildCurrentPdf.js";
import { ComparePanels } from "../ComparePanels.js";
import { CURRENT_SLUG, pickMode, pickSides, versionSide, type CompareMode, type CompareSide } from "../compareSides.js";

export const COMPARE_VERSIONS_COMMAND = "labshelf.writing.compareVersions";

interface CompareVersionsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
  builders: ProjectBuilders;
  pdfjs: PdfjsLoader;
  reader: Omit<ReaderPanelDeps, "logger" | "extensionUri">;
}

interface Sides {
  base: CompareSide;
  other: CompareSide;
}

async function currentSide(deps: CompareVersionsDeps, project: ReadyProject): Promise<CompareSide | undefined> {
  const pdfPath = await buildCurrentPdf(deps.builders, deps.projects, project, { action: "Comparing with the current build", use: "the comparison reads its PDF" });
  return pdfPath ? { slug: CURRENT_SLUG, name: "Current build", pdfPath, sourcesDir: project.folder } : undefined;
}

// A project without LaTeX or without latexdiff has only the highlight, so it is not asked.
async function chooseMode(project: ReadyProject): Promise<CompareMode | undefined> {
  if (project.settings.format !== "latex" || !await findExecutable("latexdiff")) { return "highlight"; }
  return pickMode();
}

async function highlight(deps: CompareVersionsDeps, panels: ComparePanels, project: ReadyProject, sides: Sides, logger: ILogger): Promise<void> {
  const options = { location: vscode.ProgressLocation.Notification, title: "Comparing versions…" };
  const changes = await vscode.window.withProgress(options, () => comparePdfs(deps.pdfjs, sides.base.pdfPath, sides.other.pdfPath, logger));
  panels.showSides(logger, project, sides, changes);
  const count = changes.before.length + changes.after.length;
  void vscode.window.showInformationMessage(count === 0 ? "No changes found." : `Found ${count} changed ${count === 1 ? "region" : "regions"}.`);
}

async function markedUp(deps: CompareVersionsDeps, panels: ComparePanels, project: ReadyProject, sides: Sides, logger: ILogger): Promise<void> {
  const toolchain = await ensureToolchain({ storageDir: deps.context.globalStorageUri.fsPath, host: deps.host, projects: deps.projects }, project);
  if (!toolchain) { return; }
  const main = project.main;
  if (!main) {
    await vscode.window.showInformationMessage("Choose the main file of the project first.");
    return;
  }
  const name = `${sides.base.slug}-vs-${sides.other.slug}`;
  const options = { location: vscode.ProgressLocation.Notification, title: "Building the marked-up PDF…", cancellable: true };
  const pdfPath = await vscode.window.withProgress(options, (_progress, token) => {
    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());
    return buildMarkedUpDiff({
      beforeDir: sides.base.sourcesDir, afterDir: sides.other.sourcesDir, main, toolchain, signal: abort.signal,
      outDir: path.join(projectBuildDir(project.settings.id), "compare", name),
    }, logger);
  });
  panels.showPdf(logger, project, { slug: name, name: `${sides.base.name} vs ${sides.other.name}`, pdfPath, sourcesDir: sides.other.sourcesDir }, `${name}:marked-up`);
}

async function compareProject(deps: CompareVersionsDeps, panels: ComparePanels, project: ReadyProject | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await executeSafely(session.logger, COMPARE_VERSIONS_COMMAND, async () => {
    const target = project ?? activeProject(deps.projects);
    if (!target) {
      await vscode.window.showInformationMessage("Open a file of a writing project to compare its versions.");
      return;
    }
    const versions = await listVersions(nodeProjectReadContext(session.logger), target.folder);
    if (versions.length === 0) {
      await vscode.window.showInformationMessage("Mark a version first with Research: Mark Version.");
      return;
    }
    const picked = await pickSides(versions);
    const mode = picked && await chooseMode(target);
    if (!picked || !mode) { return; }
    const other = picked.other ? versionSide(picked.other) : await currentSide(deps, target);
    if (!other) { return; }
    const sides = { base: versionSide(picked.base), other };
    await (mode === "highlight" ? highlight : markedUp)(deps, panels, target, sides, session.logger);
  });
}

export function registerCompareVersionsCommand(deps: CompareVersionsDeps): void {
  const panels = new ComparePanels({ extensionUri: deps.context.extensionUri, ...deps.reader }, deps.projects.paths);
  deps.context.subscriptions.push(vscode.commands.registerCommand(COMPARE_VERSIONS_COMMAND, (entry?: ProjectEntry) =>
    compareProject(deps, panels, entry?.kind === "ready" ? entry : undefined)));
}
