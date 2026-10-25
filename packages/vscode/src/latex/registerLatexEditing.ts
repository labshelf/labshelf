// Registers the source-aware LaTeX editing features: reference completion and diagnostics, outline, word count and math preview.
import * as vscode from "vscode";

import { registerLabelProviders } from "./labels/index.js";
import { createMathHoverProvider } from "./mathHover.js";
import { registerSectionOutline } from "./registerSectionOutline.js";
import { LatexProjectSources, type LatexProjectWorkspace } from "./project/index.js";
import { registerWordCount } from "./registerWordCount.js";

/** Returns the project sources service so other LaTeX features read the same cache. */
export function registerLatexEditing(context: vscode.ExtensionContext, workspace: LatexProjectWorkspace): LatexProjectSources {
  const sources = new LatexProjectSources(workspace);
  context.subscriptions.push(sources);
  registerLabelProviders(context, sources);
  registerSectionOutline(context, sources);
  registerWordCount(context, sources);
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: "latex" }, createMathHoverProvider(sources)));
  return sources;
}
