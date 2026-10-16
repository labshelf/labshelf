// Shows the word count of the active LaTeX project in the status bar, with the active file's count in its tooltip.
import * as vscode from "vscode";

import { countWords } from "@labshelf/core";
import type { LatexProjectSources } from "../project/index.js";
import { trailingDebounce } from "../trailingDebounce.js";
import { wordCountTooltip, wordsLabel } from "./wordCountText.js";

const REFRESH_DELAY_MS = 300;

export function registerWordCount(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  // Priority 48 places it right after the compiler item (49).
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
  let latest = 0;

  const update = async (): Promise<void> => {
    const ticket = ++latest;
    const document = vscode.window.activeTextEditor?.document;
    const project = document && await sources.projectSourcesFor(document);
    // A slower, older update must not overwrite a newer one.
    if (ticket !== latest) { return; }
    if (!document || !project) {
      item.hide();
      return;
    }
    const total = [...project.texts.values()].reduce((sum, text) => sum + countWords(text), 0);
    item.text = `$(book) ${wordsLabel(total)}`;
    item.tooltip = wordCountTooltip(countWords(document.getText()), project.main);
    item.show();
  };

  const refresh = trailingDebounce<string>(REFRESH_DELAY_MS, () => void update());
  const onSourcesChanged = (folder: string): void => {
    const active = vscode.window.activeTextEditor?.document;
    if (active && sources.projectOf(active.uri)?.folder === folder) { refresh.call(folder); }
  };
  context.subscriptions.push(
    item, { dispose: () => refresh.dispose() },
    sources.onDidChange(onSourcesChanged),
    vscode.window.onDidChangeActiveTextEditor(() => void update()),
  );
  void update();
}
