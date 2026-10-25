// Resolves the reader theme that follows the VS Code colour theme, which is what the reader's "auto" preference means.
// Theme colours themselves live in core's reader/themePresets.ts (page pixels) and reader/dom/styles/reader.css (chrome).
import * as vscode from "vscode";
import type { EffectiveTheme } from "@labshelf/core";

const THEME_BY_KIND: Record<number, EffectiveTheme> = {
  1: "light",
  2: "dark",
  3: "high-contrast",
  4: "light", // HighContrastLight
};

/** Maps a VS Code ColorThemeKind to a reader theme; unknown kinds read as light. */
export function deriveReaderTheme(kind: number): EffectiveTheme {
  return THEME_BY_KIND[kind] ?? "light";
}

/** The reader theme for the VS Code colour theme that is active now. */
export function readAutoReaderTheme(): EffectiveTheme {
  return deriveReaderTheme(vscode.window.activeColorTheme?.kind ?? 1);
}

/** Calls back with the new reader theme whenever the VS Code colour theme changes. */
export function onAutoReaderThemeChange(callback: (theme: EffectiveTheme) => void): vscode.Disposable {
  return vscode.window.onDidChangeActiveColorTheme((event) => { callback(deriveReaderTheme(event.kind)); });
}
