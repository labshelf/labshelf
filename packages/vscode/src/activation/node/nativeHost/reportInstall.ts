// Shows the per-browser problems an install reported.
import * as vscode from "vscode";

import type { NativeHostWarning } from "@labshelf/core/nativeHost/node";

export const SUPPORTED_BROWSERS = "Chrome, Chromium, Edge, Brave, Vivaldi or Firefox";

export function reportWarnings(warnings: readonly NativeHostWarning[]): void {
  for (const warning of warnings) void vscode.window.showWarningMessage(warning.message);
}
