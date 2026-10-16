// Asks which name to give a version: one of the usual milestones or a free name.
import * as vscode from "vscode";

import { versionSlug } from "@labshelf/core";

const OTHER = "Other name…";
const MILESTONES = ["submitted", "rebuttal", "camera-ready"];

/** @returns the chosen name, or undefined when the user cancels */
export async function pickVersionName(): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick([...MILESTONES, OTHER], { title: "Mark Version", placeHolder: "Name this version" });
  if (picked !== OTHER) { return picked; }
  const typed = await vscode.window.showInputBox({
    title: "Mark Version",
    prompt: "Name of the version",
    validateInput: (value) => versionSlug(value) ? undefined : "Use at least one letter or digit.",
  });
  return typed?.trim() || undefined;
}
