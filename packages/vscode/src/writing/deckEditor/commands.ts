// The deck commands: New Talk and New Poster open the template gallery and write the chosen talk or poster into the active project; Present and Poster Preview open the deck's panels.
import * as vscode from "vscode";

import { detectSourceDeckKind, type DeckKind, type ILogger } from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { readBuiltPdf } from "../preview/index.js";
import { findOwningProject, type ProjectSession, type ReadyProject, type WritingProjects } from "../projects/index.js";
import type { PdfjsLocator } from "../../reader/index.js";
import { parseWireCalibration, type CalibrationStore } from "./deckMessages.js";
import type { DeckKitsHandler } from "../sourceEditor/deckKits.js";
import { newDeck } from "./newDeck.js";
import { openPosterPreviewPanel, openPresenterPanels, readDeckKind, type PdfPanelSource } from "./presenter.js";

/** `session` is the project open in the sidebar; without one, a new deck goes to the project of the focused file. */
export interface DeckCommandDeps {
  extensionUri: vscode.Uri;
  projects: Pick<WritingProjects, "list" | "paths" | "fs" | "data">;
  logger: ILogger;
  session?: Pick<ProjectSession, "project">;
  /** Where pdf.js is installed; the PDF panels of LaTeX and Typst talks and posters need it. */
  locatePdfjs?: PdfjsLocator;
  /** Builds one root of a project; Present and Poster Preview build a source talk or poster that has no PDF yet. */
  recompile?: (folder: string, root: string) => Promise<unknown>;
  /** The library's Kits the New talk or poster gallery offers; none when absent. */
  kits?: Pick<DeckKitsHandler, "list">;
}

export { deckFolderName } from "./newDeck.js";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";
const NEW_DECK = "labshelf.decks.new";
const NEW_TALK = "labshelf.decks.newTalk";
const NEW_POSTER = "labshelf.decks.newPoster";
const PRESENT = "labshelf.decks.present";
const POSTER_PREVIEW = "labshelf.decks.posterPreview";
// The poster calibration is kept in the user's globalState on this device; the key is never registered for settings sync.
const CALIBRATION_KEY = "labshelf.decks.calibration";

/** A CalibrationStore over the memento; load ignores a stored value that is not a positive finite pxPerMm with a timestamp. */
export function createGlobalCalibrationStore(memento: vscode.Memento): CalibrationStore {
  return {
    load: async () => parseWireCalibration(memento.get<unknown>(CALIBRATION_KEY)) ?? undefined,
    save: async (calibration) => { await memento.update(CALIBRATION_KEY, { pxPerMm: calibration.pxPerMm, measuredAt: calibration.measuredAt }); },
  };
}

const isSourceFile = (uri: vscode.Uri): boolean => /\.(tex|typ)$/i.test(uri.path);

/** The deck the command was given (a file, or a Talks & Posters row carrying `uri`), else the deck editor's, else a talk or poster source in the text editor. */
function deckUriOf(argument: unknown): vscode.Uri | undefined {
  if (argument instanceof vscode.Uri) return argument;
  const carried = (argument as { uri?: unknown } | null | undefined)?.uri;
  if (carried instanceof vscode.Uri) return carried;
  const input = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri; viewType?: string } | undefined;
  if (input?.viewType === DECK_EDITOR_VIEW_TYPE) return input.uri;
  const editor = vscode.window.activeTextEditor?.document.uri;
  return editor && isSourceFile(editor) ? editor : undefined;
}

/** The project and project-relative root of a source talk or poster file. */
function sourceRootOf(deps: DeckCommandDeps, uri: vscode.Uri): { project: ReadyProject; root: string } | undefined {
  const project = findOwningProject(deps.projects, uri.fsPath);
  if (!project) return undefined;
  return { project, root: deps.projects.paths.relative(project.folder, uri.fsPath).split(deps.projects.paths.sep).join("/") };
}

/** The built PDF of a source talk or poster with the source's text, building it first when it has none; undefined (after telling why) when there is none. */
async function readPdfSource(deps: DeckCommandDeps, uri: vscode.Uri): Promise<(PdfPanelSource & { kind: DeckKind | null }) | undefined> {
  const found = sourceRootOf(deps, uri);
  if (!found) {
    await vscode.window.showWarningMessage("This file is not in a writing project.");
    return undefined;
  }
  const { project, root } = found;
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  const format = project.settings.format === "typst" ? "typst" : "latex";
  let pdf = await readBuiltPdf(deps.projects, project, root);
  if (!pdf && deps.recompile) {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Building ${root}…` }, () => deps.recompile!(project.folder, root));
    pdf = await readBuiltPdf(deps.projects, project, root);
  }
  if (!pdf) {
    await vscode.window.showWarningMessage(`${root} has no PDF yet. Build it, then try again.`);
    return undefined;
  }
  return { pdf: vscode.Uri.file(pdf), format, text, kind: detectSourceDeckKind(format, text) };
}

async function present(deps: DeckCommandDeps, argument: unknown): Promise<void> {
  const deckUri = deckUriOf(argument);
  if (!deckUri) {
    await vscode.window.showInformationMessage("Open a talk first.");
    return;
  }
  const source = isSourceFile(deckUri) ? await readPdfSource(deps, deckUri) : undefined;
  if (isSourceFile(deckUri) && !source) return;
  const kind = source ? source.kind : await readDeckKind(deckUri);
  if (kind === "poster") {
    await vscode.window.showWarningMessage("Present works for talks; use Poster Preview for posters.");
    return;
  }
  await openPresenterPanels(deckUri, deps, source);
}

async function posterPreview(deps: DeckCommandDeps, store: ReturnType<typeof createGlobalCalibrationStore>, argument: unknown): Promise<void> {
  const deckUri = deckUriOf(argument);
  if (!deckUri) {
    await vscode.window.showInformationMessage("Open a poster first.");
    return;
  }
  const source = isSourceFile(deckUri) ? await readPdfSource(deps, deckUri) : undefined;
  if (isSourceFile(deckUri) && !source) return;
  await openPosterPreviewPanel(deckUri, deps, store, source);
}

/** Registers labshelf.decks.new, newTalk, newPoster, present and posterPreview; the calibration lives in globalState and is never synced. */
export function registerDeckCommands(context: vscode.ExtensionContext, deps: DeckCommandDeps): void {
  const store = createGlobalCalibrationStore(context.globalState);
  const safely = (id: string, action: (argument: unknown) => Promise<void>) => (argument?: unknown): Promise<void> => runSafely(deps.logger, id, () => action(argument));
  context.subscriptions.push(
    vscode.commands.registerCommand(NEW_DECK, safely(NEW_DECK, () => newDeck(deps))),
    vscode.commands.registerCommand(NEW_TALK, safely(NEW_TALK, () => newDeck(deps, "talk"))),
    vscode.commands.registerCommand(NEW_POSTER, safely(NEW_POSTER, () => newDeck(deps, "poster"))),
    vscode.commands.registerCommand(PRESENT, safely(PRESENT, (argument) => present(deps, argument))),
    vscode.commands.registerCommand(POSTER_PREVIEW, safely(POSTER_PREVIEW, (argument) => posterPreview(deps, store, argument))),
  );
}
