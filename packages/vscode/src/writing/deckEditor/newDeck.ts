// New talk or poster: asks the kind, the format (the visual HTML editor or the project's LaTeX or Typst), a title and a size, writes the
// deck folder (talks/<name>/ or posters/<name>/) and opens it, so nobody has to know the folder convention.
import * as vscode from "vscode";

import {
  deckFolderName, deckRootOf, findFreeDeckName, listDeckSizePresets, listSourceDeckShapes, scaffoldDeck, scaffoldSourceDeck, sourceDeckMainFile,
  type DeckKind, type DeckSizePreset, type SourceDeckFormat, type SourceDeckShape,
} from "@labshelf/core";
import { readActiveProject } from "../build/index.js";
import type { ReadyProject } from "../projects/index.js";
import type { DeckCommandDeps } from "./commands.js";

export { deckFolderName } from "@labshelf/core";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";
const DEFAULT_PRESET: Record<DeckKind, string> = { talk: "16:9", poster: "A0 portrait" };
const NOUN: Record<DeckKind, string> = { talk: "Talk", poster: "Poster" };

/** The size presets of the kind with the default first. */
function presetsOf(kind: DeckKind): DeckSizePreset[] {
  const presets = listDeckSizePresets(kind);
  const first = presets.find((preset) => preset.label === DEFAULT_PRESET[kind]);
  return first ? [first, ...presets.filter((preset) => preset !== first)] : presets;
}

type Format = "html" | SourceDeckFormat;

async function pickKind(): Promise<DeckKind | undefined> {
  const picked = await vscode.window.showQuickPick([
    { label: "Talk", description: "Slides to present, with a presenter view", value: "talk" as const },
    { label: "Poster", description: "One page to print, with a real-size preview", value: "poster" as const },
  ], { title: "New talk or poster", placeHolder: "What do you want to make?" });
  return picked?.value;
}

async function pickFormat(kind: DeckKind, project: ReadyProject): Promise<Format | undefined> {
  const source: SourceDeckFormat = project.settings.format === "typst" ? "typst" : "latex";
  const sourceLabel = source === "typst" ? "Typst" : "LaTeX";
  const sourceDetail = source === "typst"
    ? `Written in Typst like the paper, compiled to PDF${kind === "talk" ? "; one slide per == heading" : ""}`
    : kind === "talk" ? "Beamer slides, compiled to PDF like the paper" : "A tikzposter, compiled to PDF like the paper";
  const picked = await vscode.window.showQuickPick([
    { label: "Visual", description: "Drag-and-drop editor", detail: "Click to edit text, drag and resize blocks, change the theme. Saved as HTML.", format: "html" as const },
    { label: sourceLabel, description: "Write the source", detail: sourceDetail, format: source },
  ], { title: `New ${NOUN[kind].toLowerCase()}: how do you want to make it?` });
  return picked?.format;
}

/** The shape of a source talk or poster, from the sizes core offers for its kind and format. */
async function pickSourceShape(kind: DeckKind, format: SourceDeckFormat): Promise<SourceDeckShape | undefined> {
  const picked = await vscode.window.showQuickPick(listSourceDeckShapes(kind, format).map((choice) => ({ label: choice.label, ...(choice.description ? { description: choice.description } : {}), shape: choice.shape })), { title: `${NOUN[kind]} size` });
  return picked?.shape;
}

/** Writes a visual deck (deck.html and theme.css) after asking its size, and opens it in the deck editor. */
async function writeVisualDeck(deps: DeckCommandDeps, kind: DeckKind, folder: string, name: string): Promise<boolean> {
  const picked = await vscode.window.showQuickPick(presetsOf(kind).map((preset) => ({ label: preset.label, preset })), { placeHolder: `${NOUN[kind]} size` });
  if (!picked) return false;
  const { paths } = deps.projects;
  const { html, theme } = scaffoldDeck(kind, name, picked.preset.size);
  const encoder = new TextEncoder();
  const deckUri = vscode.Uri.file(paths.join(folder, "deck.html"));
  await vscode.workspace.fs.writeFile(deckUri, encoder.encode(html));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.join(folder, "theme.css")), encoder.encode(theme));
  await vscode.commands.executeCommand("vscode.openWith", deckUri, DECK_EDITOR_VIEW_TYPE);
  return true;
}

/** Writes a LaTeX or Typst talk or poster (its main file) after asking its size, and opens the source. */
async function writeSourceDeck(deps: DeckCommandDeps, kind: DeckKind, format: SourceDeckFormat, folder: string, title: string): Promise<boolean> {
  const shape = await pickSourceShape(kind, format);
  if (!shape) return false;
  const uri = vscode.Uri.file(deps.projects.paths.join(folder, sourceDeckMainFile(format)));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(scaffoldSourceDeck(format, title, shape)));
  await vscode.commands.executeCommand("vscode.open", uri);
  return true;
}

/** Asks what to make (kind unless given, format, title, size), writes it into the open project and opens it. */
export async function newDeck(deps: DeckCommandDeps, given?: DeckKind): Promise<void> {
  const project = deps.session?.project ?? readActiveProject(deps.projects);
  if (!project) {
    await vscode.window.showWarningMessage("Open a writing project first.");
    return;
  }
  const kind = given ?? (await pickKind());
  if (!kind) return;
  const format = await pickFormat(kind, project);
  if (!format) return;
  const noun = NOUN[kind];
  const title = (await vscode.window.showInputBox({ title: `${noun} title`, prompt: `${noun} title` }))?.trim();
  if (!title) return;
  const root = deps.projects.paths.join(project.folder, deckRootOf(kind));
  const name = await findFreeDeckName(deps.projects, root, deckFolderName(title));
  const folder = deps.projects.paths.join(root, name);
  if (format === "html") await writeVisualDeck(deps, kind, folder, name);
  else await writeSourceDeck(deps, kind, format, folder, title);
}
