// New talk or poster: opens the template gallery with the project's formats and the library's Kits, writes the chosen template's files
// into the deck folder (talks/<name>/ or posters/<name>/) and opens it, so nobody has to know the folder convention.
import * as vscode from "vscode";

import { deckFolderName, deckRootOf, findFreeDeckName, scaffoldDeckFromTemplate, type DeckKind, type DeckKit } from "@labshelf/core";
import { readActiveProject } from "../build/index.js";
import type { DeckCommandDeps } from "./commands.js";
import { openNewDeckPanel } from "./newDeckPanel.js";

export { deckFolderName } from "@labshelf/core";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";

/** The library's Kits; none when there is no handler or listing them fails. */
async function listKits(deps: DeckCommandDeps): Promise<DeckKit[]> {
  try {
    return (await deps.kits?.list()) ?? [];
  } catch (error) {
    void deps.logger.log("WARN", "decks", `New talk or poster: could not list the Kits: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Shows the gallery (with the kind when given), writes the chosen talk or poster into the open project and opens it. */
export async function newDeck(deps: DeckCommandDeps, given?: DeckKind): Promise<void> {
  const project = deps.session?.project ?? readActiveProject(deps.projects);
  if (!project) {
    await vscode.window.showWarningMessage("Open a writing project first.");
    return;
  }
  const kits = await listKits(deps);
  const source = project.settings.format === "typst" ? "typst" : "latex";
  const choice = await openNewDeckPanel(deps.extensionUri, { ...(given && { kind: given }), formats: ["html", source], kits });
  if (!choice) return;
  const { paths } = deps.projects;
  const root = paths.join(project.folder, deckRootOf(choice.kind));
  const name = await findFreeDeckName(deps.projects, root, deckFolderName(choice.title));
  const folder = paths.join(root, name);
  const encoder = new TextEncoder();
  let main: vscode.Uri | undefined;
  for (const file of scaffoldDeckFromTemplate(choice, name)) {
    const uri = vscode.Uri.file(paths.join(folder, ...file.path.split("/")));
    await vscode.workspace.fs.writeFile(uri, encoder.encode(file.text));
    if (file.path === "deck.html" || /^main\.(tex|typ)$/.test(file.path)) main = uri;
  }
  if (!main) return;
  if (main.path.endsWith("/deck.html")) await vscode.commands.executeCommand("vscode.openWith", main, DECK_EDITOR_VIEW_TYPE);
  else await vscode.commands.executeCommand("vscode.open", main);
}
