// Asks which highlight of a paper to cite, and whether to quote it, or to cite without a page.
import * as vscode from "vscode";

import type { Annotation } from "@labshelf/core";

const LABEL_LENGTH = 120;
const QUOTE_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("quote"), tooltip: "Cite with quotation" };

/** `highlight` is undefined for a citation without a page. */
export interface HighlightChoice {
  highlight?: Annotation;
  quote: boolean;
}

interface HighlightPickItem extends vscode.QuickPickItem {
  highlight?: Annotation;
}

function singleLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LENGTH ? `${flat.slice(0, LABEL_LENGTH).trimEnd()}…` : flat;
}

function pickItems(highlights: readonly Annotation[]): HighlightPickItem[] {
  return [
    { label: "Cite without a page" },
    ...highlights.map((highlight) => ({
      label: singleLine(highlight.content),
      description: `p. ${highlight.pageNumber}`,
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
