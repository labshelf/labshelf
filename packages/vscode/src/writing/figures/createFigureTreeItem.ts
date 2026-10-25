// Shows a figure as a Writing view row: stale or missing marked, the newer inputs and the command in the tooltip, opened on click.
import * as vscode from "vscode";

import type { ArcKind, PathOps } from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";
import type { FigureNode } from "./figureNode.js";

const STALE_FIGURE_CONTEXT = "labshelfFigureStale";
const FRESH_FIGURE_CONTEXT = "labshelfFigure";

const TONE: Record<FigureNode["state"]["status"], ArcKind> = { stale: "warn", missing: "err", fresh: "ok" };

function tooltip(node: FigureNode): string {
  const { state } = node;
  const lines = [node.path];
  if (state.status === "fresh") { lines.push("Fresh: the figure is newer than its inputs."); }
  if (state.status === "missing") { lines.push("Missing: the figure file does not exist."); }
  if (state.status === "stale") { lines.push("Stale: newer inputs", ...state.newerInputs.map((input) => `  ${input}`)); }
  if (state.missingInputs.length > 0) { lines.push("Inputs not found", ...state.missingInputs.map((input) => `  ${input}`)); }
  lines.push(`Command: ${node.recipe.run}`);
  return lines.join("\n");
}

export function createFigureTreeItem(node: FigureNode, paths: PathOps, arcIcon: ArcIcon): vscode.TreeItem {
  const { status } = node.state;
  const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None);
  item.id = `${node.project.folder}#figure:${node.path}`;
  item.contextValue = status === "fresh" ? FRESH_FIGURE_CONTEXT : STALE_FIGURE_CONTEXT;
  item.iconPath = arcIcon(TONE[status], "full");
  if (status !== "fresh") { item.description = status; }
  item.tooltip = tooltip(node);
  if (status !== "missing") {
    const file = vscode.Uri.file(paths.join(node.project.folder, node.path));
    item.command = { command: "vscode.open", title: "Open Figure", arguments: [file] };
  }
  return item;
}
