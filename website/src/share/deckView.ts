// Shows a shared deck on the share page: the deck viewer over the page's main area, with Download HTML saving the single file.
import type { OpenedAnyShare } from "@labshelf/core";
import { mountDeckShareViewer } from "@labshelf/core/dom";

import { saveFile } from "./shareDownloads.js";
import { openErrorState, renderState } from "./shareStates.js";

export async function showDeck(root: HTMLElement, opened: Extract<OpenedAnyShare, { kind: "deck" }>): Promise<void> {
  const result = await opened.loadHtml();
  if (!result.ok) {
    const error = result.error === "network" ? "network" : result.error === "missing" ? "removed" : "unreadable";
    renderState(root, openErrorState(error, () => { void showDeck(root, opened); }));
    return;
  }
  root.replaceChildren();
  mountDeckShareViewer(root, {
    title: opened.manifest.title,
    deck: opened.manifest.deck,
    html: result.html,
    download: (bytes, filename) => { saveFile(filename, bytes, "text/html"); },
  });
}
