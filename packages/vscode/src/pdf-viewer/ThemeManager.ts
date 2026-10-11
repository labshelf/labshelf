/**
 * Maps VS Code colour themes to reader themes, which is what the reader's "auto" theme follows in VS Code.
 * Theme colours themselves live in core's reader/themePresets.ts (page pixels) and reader/dom/styles/reader.css (chrome).
 */
import * as vscode from "vscode";
import { isPdfTheme, type PdfTheme } from "@labshelf/core";

// Mapping from VS Code ColorThemeKind to pdf theme names
const VSCODE_THEME_MAP: Record<number, PdfTheme> = {
  1: 'light',   // ColorThemeKind.Light
  2: 'dark',    // ColorThemeKind.Dark
  3: 'high-contrast',  // ColorThemeKind.HighContrast
  4: 'light',   // ColorThemeKind.HighContrastLight
};

export class ThemeManager {
  /**
   * Maps a VS Code ColorThemeKind number to the corresponding PDF theme name.
   * @returns A PdfTheme string such as 'light', 'dark', or 'high-contrast'.
   */
  mapVsCodeTheme(kind: number): PdfTheme {
    return VSCODE_THEME_MAP[kind] ?? 'light';
  }

  /**
   * Resolves the effective theme name, converting 'auto' to the current VS Code theme name.
   * @returns The resolved theme string (e.g., 'light', 'dark', 'sepia').
   */
  getEffectiveTheme(preference: string = 'auto'): string {
    if (preference === 'auto') {
      const kind = vscode.window.activeColorTheme?.kind ?? 1;
      return this.mapVsCodeTheme(kind);
    }
    if (isPdfTheme(preference)) {
      return preference;
    }
    return 'light';
  }

  /**
   * Registers a callback to be called with the new effective theme whenever the VS Code color theme changes.
   * @returns A vscode.Disposable that unregisters the listener when disposed.
   */
  onVsCodeThemeChange(callback: (effectiveTheme: string) => void): vscode.Disposable {
    return vscode.window.onDidChangeActiveColorTheme((event) => {
      const newTheme = this.mapVsCodeTheme(event.kind);
      callback(newTheme);
    });
  }
}
