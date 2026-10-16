// Resolves the light/dark baked mark icon files (Arc marks and the REF glyph) for native tree items.
// PLATFORM: TreeItem icons cannot read CSS variables, and the workbench CSP blocks icons served from globalStorage (vscode-userdata:); build/arcMarks.mjs bakes each colour into SVG files under out/marks/ inside the extension folder.
import * as vscode from "vscode";
import type { ArcProgress, ArcTone } from "@labshelf/core";

export type ThemedIcon = { light: vscode.Uri; dark: vscode.Uri };
export type ArcIcon = (tone: ArcTone, progress: ArcProgress) => ThemedIcon;

function themedMark(extensionUri: vscode.Uri, name: string): ThemedIcon {
  return {
    light: vscode.Uri.joinPath(extensionUri, "out", "marks", `${name}-light.svg`),
    dark: vscode.Uri.joinPath(extensionUri, "out", "marks", `${name}-dark.svg`),
  };
}

export function arcIcons(extensionUri: vscode.Uri): ArcIcon {
  return (tone, progress) => themedMark(extensionUri, `${tone}-${progress}`);
}

/** The REF glyph a paper row shows. */
export function refIcon(extensionUri: vscode.Uri): ThemedIcon {
  return themedMark(extensionUri, "ref");
}
