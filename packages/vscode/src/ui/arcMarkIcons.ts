// Resolves the light/dark Arc mark icon files of a tone and progress for native tree items.
// PLATFORM: TreeItem icons cannot read CSS variables, and the workbench CSP blocks icons served from globalStorage (vscode-userdata:); build/arcMarks.mjs bakes each tone's colour into SVG files under out/marks/ inside the extension folder.
import * as vscode from "vscode";
import type { ArcProgress, ArcTone } from "@labshelf/core";

export type ArcIcon = (tone: ArcTone, progress: ArcProgress) => { light: vscode.Uri; dark: vscode.Uri };

function markFile(extensionUri: vscode.Uri, tone: ArcTone, progress: ArcProgress, theme: "light" | "dark"): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "out", "marks", `${tone}-${progress}-${theme}.svg`);
}

export function arcIcons(extensionUri: vscode.Uri): ArcIcon {
  return (tone, progress) => ({
    light: markFile(extensionUri, tone, progress, "light"),
    dark: markFile(extensionUri, tone, progress, "dark"),
  });
}
