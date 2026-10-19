// Asks which highlight of a paper to cite, and whether to quote it, or to cite without a page.
import * as vscode from "vscode";

import { CITE_WITHOUT_PAGE, highlightLabel, highlightPage, type Annotation, type HighlightChoice } from "@labshelf/core";

const QUOTE_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("quote"), tooltip: "Cite with quotation" };

interface HighlightPickItem extends vscode.QuickPickItem {
  highlight?: Annotation;
}

function pickItems(highlights: readonly Annotation[]): HighlightPickItem[] {
  return [
    { label: CITE_WITHOUT_PAGE },
    ...highlights.map((highlight) => ({
      label: highlightLabel(highlight),
      description: highlightPage(highlight),
      buttons: [QUOTE_BUTTON],
      highlight,
    })),
  ];
}

/** Resolves when the user accepts an item or clicks its quote button; undefined when the picker is dismissed. */
export function chooseHighlight(highlights: readonly Annotation[]): Promise<HighlightChoice | undefined> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<HighlightPickItem>();
    let choice: HighlightChoice | undefined;
    const settle = (picked: HighlightChoice): void => {
      choice = picked;
      picker.hide();
    };
    picker.title = "Cite from Library";
    picker.placeholder = "Pick a highlight to cite its page";
    picker.matchOnDescription = true;
    picker.items = pickItems(highlights);
    picker.onDidAccept(() => {
      const [item] = picker.selectedItems;
      if (item) { settle({ ...(item.highlight ? { highlight: item.highlight } : {}), quote: false }); }
    });
    picker.onDidTriggerItemButton(({ item }) => settle({ ...(item.highlight ? { highlight: item.highlight } : {}), quote: true }));
    picker.onDidHide(() => {
      picker.dispose();
      resolve(choice);
    });
    picker.show();
  });
}
