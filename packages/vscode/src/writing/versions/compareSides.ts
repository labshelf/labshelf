// Asks which two versions of a project to compare and which kind of comparison to run.
import * as vscode from "vscode";

import type { ProjectVersion } from "@labshelf/core";

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

export function versionSide(version: ProjectVersion): CompareSide {
  return { slug: version.slug, name: version.name, pdfPath: version.pdfPath, sourcesDir: version.sourcesDir };
}

/** @returns the base version and the version to compare it with (undefined for the current build), or undefined when the user cancels */
export async function pickSides(versions: readonly ProjectVersion[]): Promise<{ base: ProjectVersion; other: ProjectVersion | undefined } | undefined> {
  const base = await vscode.window.showQuickPick(versions.map(versionItem), { title: TITLE, placeHolder: "Compare version…" });
  if (!base?.version) { return undefined; }
  const baseSlug = base.version.slug;
  const current: SideItem = { label: "Current build", description: "Builds the project first", version: undefined };
  const others = [current, ...versions.filter((version) => version.slug !== baseSlug).map(versionItem)];
  const other = await vscode.window.showQuickPick(others, { title: TITLE, placeHolder: "…with" });
  return other ? { base: base.version, other: other.version } : undefined;
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
