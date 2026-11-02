// The deck commands: New Talk and New Poster scaffold a deck into the active project and open it in the deck editor; Present and Poster Preview open the deck's panels.
import * as vscode from "vscode";

import { deckRootOf, listDeckSizePresets, scaffoldDeck, type DeckKind, type DeckSizePreset, type ILogger } from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { readActiveProject } from "../build/index.js";
import type { WritingProjects } from "../projects/index.js";
import { createGlobalCalibrationStore } from "./calibration.js";
import { openPosterPreviewPanel, openPresenterPanels, readDeckKind } from "./presenter.js";

export interface DeckCommandDeps { extensionUri: vscode.Uri; projects: Pick<WritingProjects, "list" | "paths" | "fs">; logger: ILogger }

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";
const NEW_TALK = "labshelf.decks.newTalk";
const NEW_POSTER = "labshelf.decks.newPoster";
const PRESENT = "labshelf.decks.present";
const POSTER_PREVIEW = "labshelf.decks.posterPreview";
const MAX_NAME_LENGTH = 40;
const DEFAULT_PRESET: Record<DeckKind, string> = { talk: "16:9", poster: "A0 portrait" };

/** A deck folder name for a title: ASCII letters and digits in lower case joined by single hyphens, at most 40 characters, "deck" when nothing is left. */
export function deckFolderName(title: string): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH).replace(/-+$/, "");
  return slug || "deck";
}

/** The first of <name>, <name>-2, <name>-3… whose folder does not exist under the deck root. */
async function freeFolderName(deps: DeckCommandDeps, root: string, base: string): Promise<string> {
  const { paths, fs } = deps.projects;
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!(await fs.exists(paths.join(root, name)))) return name;
  }
}

/** The size presets of the kind with the default first. */
function presetsOf(kind: DeckKind): DeckSizePreset[] {
  const presets = listDeckSizePresets(kind);
  const first = presets.find((preset) => preset.label === DEFAULT_PRESET[kind]);
  return first ? [first, ...presets.filter((preset) => preset !== first)] : presets;
}

async function newDeck(deps: DeckCommandDeps, kind: DeckKind): Promise<void> {
  const project = readActiveProject(deps.projects);
  if (!project) {
    await vscode.window.showWarningMessage("Open a writing project first.");
    return;
  }
  const noun = kind === "talk" ? "Talk" : "Poster";
  const title = (await vscode.window.showInputBox({ title: `${noun} title`, prompt: `${noun} title` }))?.trim();
  if (!title) return;
  const picked = await vscode.window.showQuickPick(presetsOf(kind).map((preset) => ({ label: preset.label, preset })), { placeHolder: `${noun} size` });
  if (!picked) return;
  const { paths } = deps.projects;
  const root = paths.join(project.folder, deckRootOf(kind));
  const name = await freeFolderName(deps, root, deckFolderName(title));
  const { html, theme } = scaffoldDeck(kind, name, picked.preset.size);
  const folder = paths.join(root, name);
  const encoder = new TextEncoder();
  const deckUri = vscode.Uri.file(paths.join(folder, "deck.html"));
  await vscode.workspace.fs.writeFile(deckUri, encoder.encode(html));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.join(folder, "theme.css")), encoder.encode(theme));
  await vscode.commands.executeCommand("vscode.openWith", deckUri, DECK_EDITOR_VIEW_TYPE);
}

/** The deck file the command was given, else the one the active custom editor shows. */
function deckUriOf(argument: unknown): vscode.Uri | undefined {
  if (argument instanceof vscode.Uri) return argument;
  const input = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri; viewType?: string } | undefined;
  return input?.viewType === DECK_EDITOR_VIEW_TYPE ? input.uri : undefined;
}

async function present(deps: DeckCommandDeps, argument: unknown): Promise<void> {
  const deckUri = deckUriOf(argument);
  if (!deckUri) {
    await vscode.window.showInformationMessage("Open a talk in the deck editor first.");
    return;
  }
  if ((await readDeckKind(deckUri)) === "poster") {
    await vscode.window.showWarningMessage("Present works for talks; use Poster Preview for posters.");
    return;
  }
  await openPresenterPanels(deckUri, deps);
}

async function posterPreview(deps: DeckCommandDeps, store: ReturnType<typeof createGlobalCalibrationStore>, argument: unknown): Promise<void> {
  const deckUri = deckUriOf(argument);
  if (!deckUri) {
    await vscode.window.showInformationMessage("Open a poster in the deck editor first.");
    return;
  }
  await openPosterPreviewPanel(deckUri, deps, store);
}

/** Registers labshelf.decks.newTalk, newPoster, present and posterPreview; the calibration lives in globalState and is never synced. */
export function registerDeckCommands(context: vscode.ExtensionContext, deps: DeckCommandDeps): void {
  const store = createGlobalCalibrationStore(context.globalState);
  const safely = (id: string, action: (argument: unknown) => Promise<void>) => (argument?: unknown): Promise<void> => runSafely(deps.logger, id, () => action(argument));
  context.subscriptions.push(
    vscode.commands.registerCommand(NEW_TALK, safely(NEW_TALK, () => newDeck(deps, "talk"))),
    vscode.commands.registerCommand(NEW_POSTER, safely(NEW_POSTER, () => newDeck(deps, "poster"))),
    vscode.commands.registerCommand(PRESENT, safely(PRESENT, (argument) => present(deps, argument))),
    vscode.commands.registerCommand(POSTER_PREVIEW, safely(POSTER_PREVIEW, (argument) => posterPreview(deps, store, argument))),
  );
}
