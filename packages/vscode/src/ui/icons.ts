// Resolves the icons the host draws natively: the editor tab icon and the light/dark baked mark icons (Arc marks) for tree items.
// PLATFORM: webview tabs take no ThemeIcon or currentColor, and TreeItem icons cannot read CSS variables; the workbench CSP also blocks icons served from globalStorage (vscode-userdata:). So the colours are baked into light and dark SVG files: media/ for the tab, and out/marks/ (build/arcMarks.mjs) for the marks.
import * as vscode from "vscode";
import type { ArcState, ArcKind } from "@labshelf/core";

type ThemedIcon = { light: vscode.Uri; dark: vscode.Uri };
export type ArcIcon = (tone: ArcKind, progress: ArcState) => ThemedIcon;

/**
 * The light/dark icon pair every LabShelf editor tab (list, reader) carries: the extension's ">" mark in blue.
 * @returns URIs of the blue chevron SVGs under media/, to assign to a WebviewPanel's iconPath
 */
export function createTabIcon(extensionUri: vscode.Uri): ThemedIcon {
  return {
    light: vscode.Uri.joinPath(extensionUri, "media", "labshelf-tab-light.svg"),
    dark: vscode.Uri.joinPath(extensionUri, "media", "labshelf-tab-dark.svg"),
  };
}

function themedMark(extensionUri: vscode.Uri, name: string): ThemedIcon {
  return {
    light: vscode.Uri.joinPath(extensionUri, "out", "marks", `${name}-light.svg`),
    dark: vscode.Uri.joinPath(extensionUri, "out", "marks", `${name}-dark.svg`),
  };
}

export function createArcIcons(extensionUri: vscode.Uri): ArcIcon {
  return (tone, progress) => themedMark(extensionUri, `${tone}-${progress}`);
}
