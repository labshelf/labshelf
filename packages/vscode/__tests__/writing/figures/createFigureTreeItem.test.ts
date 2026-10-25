// Tests a figure row's Arc mark and tooltip for each figure status.
import * as vscode from "vscode";
import * as path from "node:path";

import type { FigureNode, ReadyProject } from "../../../src/writing/figures";
import { createFigureTreeItem } from "../../../src/writing/figures";
import { readyEntry } from "../../support/writingFixtures";

const arcIcon = (tone: string, progress: string) => ({
  light: vscode.Uri.file(`/marks/${tone}-${progress}-light.svg`),
  dark: vscode.Uri.file(`/marks/${tone}-${progress}-dark.svg`),
});

function node(state: FigureNode["state"]): FigureNode {
  const project = readyEntry("/code/paper") as ReadyProject;
  return { kind: "figure", project, path: "fig/a.pdf", recipe: { run: "python plot.py", inputs: [] }, state };
}

describe("createFigureTreeItem", () => {
  it.each([
    [{ status: "stale", newerInputs: ["plot.py"], missingInputs: [] }, "warn", "Stale"],
    [{ status: "missing", missingInputs: [] }, "err", "Missing"],
    [{ status: "fresh", missingInputs: [] }, "ok", "Fresh"],
  ] as const)("marks a %o figure with a full %s arc and names the status in the tooltip", (state, tone, label) => {
    const item = createFigureTreeItem(node(state as FigureNode["state"]), path, arcIcon);
    expect(item.iconPath).toEqual(arcIcon(tone, "full"));
    expect(item.tooltip).toContain(label);
  });
});
