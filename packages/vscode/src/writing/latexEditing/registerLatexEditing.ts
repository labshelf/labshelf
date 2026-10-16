// Registers the source-aware LaTeX editing features: reference completion and diagnostics, outline, word count and math preview.
import * as vscode from "vscode";

import { registerLabelProviders } from "./labels/index.js";
import { mathHoverProvider } from "./math/index.js";
import { registerSectionOutline } from "./outline/index.js";
import { LatexProjectSources, type LatexProjectWorkspace } from "./project/index.js";
import { registerWordCount } from "./wordCount/index.js";

/** Returns the project sources service so other LaTeX features read the same cache. */
export function registerLatexEditing(context: vscode.ExtensionContext, workspace: LatexProjectWorkspace): LatexProjectSources {
  const sources = new LatexProjectSources(workspace);
  context.subscriptions.push(sources);
  registerLabelProviders(context, sources);
  registerSectionOutline(context, sources);
  registerWordCount(context, sources);
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: "latex" }, mathHoverProvider(sources)));
  return sources;
}
