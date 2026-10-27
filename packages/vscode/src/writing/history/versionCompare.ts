// What a version comparison needs: the sides and the pickers that choose them, the build of the current PDF and the reader panels that show the result.
import * as vscode from "vscode";

import { createPreviewStore, type ILogger, type PageArea, type PaperRecord, type PathOps, type ProjectVersion } from "@labshelf/core";
import { ReaderPanel, type ReaderPanelDeps } from "../../reader/index.js";
import type { ProjectBuilders } from "../build/index.js";
import type { ReadyProject } from "../buildRootDocument.js";
import { readBuiltPdf } from "../preview/index.js";
import type { WritingProjects } from "../session/index.js";

export const CURRENT_SLUG = "current";

/** One side of a comparison: a marked version or the current build. */
export interface CompareSide {
  slug: string;
  name: string;
  /** Empty for the current build until it is built. */
  pdfPath: string;
  sourcesDir: string;
}

export type CompareMode = "highlight" | "markedUp";

interface SideItem extends vscode.QuickPickItem {
  version: ProjectVersion | undefined;
}

const TITLE = "Compare Versions";

function versionItem(version: ProjectVersion): SideItem {
  return { label: version.name, description: new Date(version.created).toLocaleDateString(), version };
}

export function deriveVersionSide(version: ProjectVersion): CompareSide {
  return { slug: version.slug, name: version.name, pdfPath: version.pdfPath, sourcesDir: version.sourcesDir };
}

/** @returns the base version and the version to compare it with (undefined for the current build), or undefined when the user cancels */
export async function pickSides(versions: readonly ProjectVersion[]): Promise<{ base: ProjectVersion; other: ProjectVersion | undefined } | undefined> {
  const base = (await vscode.window.showQuickPick(versions.map(versionItem), { title: TITLE, placeHolder: "Compare version…" }))?.version;
  if (!base) { return undefined; }
  const current: SideItem = { label: "Current build", description: "Builds the project first", version: undefined };
  const others = [current, ...versions.filter((version) => version.slug !== base.slug).map(versionItem)];
  const other = await vscode.window.showQuickPick(others, { title: TITLE, placeHolder: "…with" });
  return other ? { base, other: other.version } : undefined;
}

interface ModeItem extends vscode.QuickPickItem {
  mode: CompareMode;
}

/** @returns how to show the differences, or undefined when the user cancels */
export async function pickMode(): Promise<CompareMode | undefined> {
  const items: ModeItem[] = [
    { label: "Highlight changed pages", description: "Marks the changed regions in two side-by-side readers", mode: "highlight" },
    { label: "Marked-up PDF (latexdiff)", description: "One PDF with additions and deletions marked in the text", mode: "markedUp" },
  ];
  return (await vscode.window.showQuickPick(items, { title: TITLE, placeHolder: "How should the differences show?" }))?.mode;
}

/** `action` names what needs the build ("Marking a version") and `use` why it needs the PDF ("a version keeps its PDF"). */
export interface BuildPurpose {
  action: string;
  use: string;
}

// Saves the open files and builds a project so a version command can use the PDF of its sources as they are now.
/** @returns the built PDF's path, or undefined after telling the user why there is none */
export async function buildCurrentPdf(
  builders: ProjectBuilders, projects: Pick<WritingProjects, "data" | "paths" | "fs">, project: ReadyProject, purpose: BuildPurpose,
): Promise<string | undefined> {
  await vscode.workspace.saveAll(false);
  const build = await builders[project.settings.format].request(project.folder, project.main ?? "", "command");
  if (build?.status !== "succeeded") {
    await vscode.window.showWarningMessage(`${purpose.action} needs a successful build. The build problems are listed in Problems.`);
    return undefined;
  }
  const pdfPath = await readBuiltPdf(projects, project, project.main);
  if (!pdfPath) { await vscode.window.showInformationMessage(`Build the project first; ${purpose.use}.`); }
  return pdfPath;
}

type ShowIn = NonNullable<Parameters<typeof ReaderPanel.createOrShow>[1]["show"]>;

interface OpenedPanel {
  panel: ReaderPanel;
  /** False when the panel was already open and only revealed. */
  fresh: boolean;
}

// Opens the reader panels of a version comparison: one per side, or one for a marked-up PDF.
export class ComparePanels {
  private readonly open = new Set<string>();

  constructor(private readonly deps: Omit<ReaderPanelDeps, "logger">, private readonly paths: PathOps) {}

  /** Shows `base` in the active column and `other` beside it, each with its changed regions marked. */
  showSides(logger: ILogger, project: ReadyProject, sides: { base: CompareSide; other: CompareSide }, changes: { before: PageArea[]; after: PageArea[] }): void {
    const base = this.show(logger, project, sides.base, `compare:${project.folder}:${sides.base.slug}`, vscode.ViewColumn.Active);
    const other = this.show(logger, project, sides.other, `compare:${project.folder}:${sides.other.slug}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    this.mark(base, changes.before);
    this.mark(other, changes.after);
  }

  /** Shows one PDF, e.g. a marked-up diff, beside the editor. */
  showPdf(logger: ILogger, project: ReadyProject, side: CompareSide, key: string): void {
    this.show(logger, project, side, `compare:${project.folder}:${key}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });
  }

  // A panel left open by an earlier comparison may show a stale file (the current build changed); a fresh one loads it once.
  private mark({ panel, fresh }: OpenedPanel, areas: PageArea[]): void {
    if (!fresh) { panel.controller.reloadDocument(); }
    panel.controller.showChanges(areas);
  }

  private show(logger: ILogger, project: ReadyProject, side: CompareSide, key: string, column: ShowIn): OpenedPanel {
    const fresh = !this.open.has(key);
    const dir = this.paths.dirname(side.pdfPath);
    const paper: PaperRecord = {
      id: `compare:${project.settings.id}:${side.slug}`, title: `${side.name} — ${project.settings.id}`, path: dir, citeKey: "", status: "reading",
    };
    const panel = ReaderPanel.createOrShow({ ...this.deps, logger }, {
      key, paper, store: createPreviewStore(), pdfUri: vscode.Uri.file(side.pdfPath), rootDir: vscode.Uri.file(dir), show: column,
      onClosed: () => { this.open.delete(key); },
    });
    this.open.add(key);
    return { panel, fresh };
  }
}
