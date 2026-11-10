// The deck commands: New Talk and New Poster open the template gallery and write the chosen talk or poster into the active project; Present and Poster Preview open the deck's panels.
import * as vscode from "vscode";

import {
  createNonce, deckFolderName, deckRootOf, deckTemplateFormats, detectSourceDeckKind, findFreeDeckName, lastDeckPageMap, parseDeckTemplateChoice, readTalkPages, scaffoldDeckFromTemplate,
  type DeckKind, type DeckKit, type DeckTemplateChoice, type DeckTemplateGalleryInit, type ILogger,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import { readActiveProject } from "../build/index.js";
import { readBuiltPdf } from "../preview/index.js";
import { findOwningProject, type ProjectSession, type ReadyProject, type WritingProjects } from "../projects/index.js";
import type { PdfjsLocator } from "../../reader/index.js";
import { parseWireCalibration, type CalibrationStore, type NewDeckHostMessage, type NewDeckPageMessage } from "./deckMessages.js";
import type { DeckKitsHandler } from "../sourceEditor/index.js";
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

export { deckFolderName } from "@labshelf/core";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";
const NEW_DECK_VIEW_TYPE = "labshelf.newDeck";
const NEW_DECK_TITLE = "New talk or poster";
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

/** <extension>/dist/newDeck, for localResourceRoots. */
function newDeckBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "newDeck");
}

async function newDeckPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = newDeckBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "newDeck.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: NEW_DECK_TITLE, heading: "New talk or poster bundle not built", file: "dist/newDeck/newDeck.js", reopen: "New talk or poster" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: NEW_DECK_TITLE,
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "newDeck.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
    // Kit logos and previews may arrive as data: URIs.
    images: "data",
  });
}

/**
 * The New talk or poster panel: shows the core template gallery (dist/newDeck/newDeck.js, page in webview/newDeckEntry.ts) in an editor tab
 * with the kind, formats and Kits of init. Resolves once, with the first valid choice, or null when the user cancels or closes the tab.
 */
export function openNewDeckPanel(extensionUri: vscode.Uri, init: DeckTemplateGalleryInit): Promise<DeckTemplateChoice | null> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(NEW_DECK_VIEW_TYPE, NEW_DECK_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [newDeckBundleDirectory(extensionUri), webviewChunksDir(extensionUri)],
    });
    panel.iconPath = createTabIcon(extensionUri);
    const disposables: vscode.Disposable[] = [];
    let done = false;
    const finish = (choice: DeckTemplateChoice | null): void => {
      if (done) return;
      done = true;
      resolve(choice);
      while (disposables.length) disposables.pop()?.dispose();
      panel.dispose();
    };
    void newDeckPanelHtml(panel.webview, extensionUri).then((html) => { if (!done) panel.webview.html = html; });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (done) return;
      const message = raw as NewDeckPageMessage | null;
      switch (message?.type) {
        case "ready": {
          const answer: NewDeckHostMessage = { type: "init", init };
          void panel.webview.postMessage(answer);
          return;
        }
        case "create": {
          const choice = parseDeckTemplateChoice(message.choice);
          if (choice) finish(choice);
          else console.warn("[labshelf] New talk or poster: ignored an invalid template choice", message.choice);
          return;
        }
        case "cancel":
          finish(null);
          return;
      }
    }, null, disposables);
    panel.onDidDispose(() => finish(null), null, disposables);
  });
}

/** The library's Kits; none when there is no handler or listing them fails. */
async function listKits(deps: DeckCommandDeps): Promise<DeckKit[]> {
  try {
    return (await deps.kits?.list()) ?? [];
  } catch (error) {
    void deps.logger.log("WARN", "decks", `New talk or poster: could not list the Kits: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * New talk or poster: shows the gallery (with the kind when given), writes the chosen template's files into the deck folder of the open
 * project (talks/<name>/ or posters/<name>/) and opens it, so nobody has to know the folder convention.
 */
async function newDeck(deps: DeckCommandDeps, given?: DeckKind): Promise<void> {
  const project = deps.session?.project ?? readActiveProject(deps.projects);
  if (!project) {
    await vscode.window.showWarningMessage("Open a writing project first.");
    return;
  }
  const kits = await listKits(deps);
  const choice = await openNewDeckPanel(deps.extensionUri, { ...(given && { kind: given }), formats: deckTemplateFormats(project.settings.format), kits });
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
  const pages = readTalkPages(lastDeckPageMap(project.folder, root), root, text);
  return { pdf: vscode.Uri.file(pdf), format, text, kind: detectSourceDeckKind(format, text), ...(pages && { slideOfPage: pages.slideOfPage }) };
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
