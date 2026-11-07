// The LabShelf deck editor provider: a custom text editor on a talk's or poster's deck.html whose webview runs the core deck editor, with the TextDocument and the sibling theme.css as the source of truth.
import * as vscode from "vscode";

import { createNonce, formatError, parseDeck, type ILogger } from "@labshelf/core";
import { hasBundleFile, renderBundleMissingHtml, renderDeckHtmlShell, webviewChunksDir } from "../../ui/index.js";
import { findOwningProject, type WritingProjects } from "../projects/index.js";
import type { DeckKitsHandler } from "../sourceEditor/deckKits.js";
import { parseDeckPageMessage, type DeckHostMessage, type DeckKitsMessage, type DeckPageMessage } from "./deckMessages.js";
import { createDeckSync, readThemeText, type DeckSync } from "./deckSync.js";

const MODULE = "writing/deckEditor";

export interface DeckEditorProviderDeps {
  extensionUri: vscode.Uri;
  logger: ILogger;
  projects: Pick<WritingProjects, "list" | "paths" | "fs">;
  /** Closes a project's build preview, so the deck editor takes the whole editor area. */
  closePreview?: (projectFolder: string) => void;
  /** The library's deck Kits, the one handler the LabShelf editor's decks share; absent, kits requests fail. */
  kits?: DeckKitsHandler;
}

/** <extension>/dist/deckEditor, the bundle every deck webview runs. */
export function bundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "deckEditor");
}

/** The HTML of a deck webview panel titled `title`, or the bundle-missing page. */
export async function deckPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): Promise<string> {
  const dir = bundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "deckEditor.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title, heading: "Deck editor bundle not built", file: "dist/deckEditor/deckEditor.js", reopen: "the deck" });
  }
  return renderDeckHtmlShell({
    nonce: createNonce(), cspSource: webview.cspSource, title,
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "deckEditor.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

interface DeckPanel { document: vscode.TextDocument; folder: vscode.Uri; themeUri: vscode.Uri; panel: vscode.WebviewPanel; sync: DeckSync; post(message: DeckHostMessage): void }

async function sendInit(session: DeckPanel): Promise<void> {
  const { document, folder, themeUri, panel } = session;
  const deck = document.getText();
  const theme = await readThemeText(themeUri);
  session.post({ type: "init", deck, theme, version: document.version, assetBase: `${panel.webview.asWebviewUri(folder).toString()}/`, kind: parseDeck(deck).model?.kind ?? null, title: folder.path.split("/").pop() ?? "" });
}

/** Asks for an image and answers with its path relative to the deck folder; an image from elsewhere is copied into assets/ first. */
async function pickImage(session: DeckPanel, id: number): Promise<void> {
  const [picked] = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: session.folder, filters: { Images: ["png", "jpg", "jpeg", "gif", "svg", "webp"] } }) ?? [];
  if (!picked) return session.post({ type: "pickedImage", id });
  const base = `${session.folder.path}/`;
  if (picked.path.startsWith(base)) return session.post({ type: "pickedImage", id, path: picked.path.slice(base.length) });
  const name = picked.path.split("/").pop()!;
  await vscode.workspace.fs.copy(picked, vscode.Uri.joinPath(session.folder, "assets", name), { overwrite: true });
  session.post({ type: "pickedImage", id, path: `assets/${name}` });
}

/** Answers a Kits request of the Style panel with a kitsResult of its id; a failure answers ok: false with the error. */
async function answerKits(deps: DeckEditorProviderDeps, session: DeckPanel, message: DeckKitsMessage): Promise<void> {
  const { id } = message;
  try {
    const kits = deps.kits;
    if (!kits) throw new Error("Kits are not available.");
    const value = message.request === "list" ? await kits.list()
      : message.request === "save" ? await kits.save(message.kit, message.logo)
        : await kits.pickImage();
    session.post({ type: "kitsResult", id, ok: true, value });
  } catch (error) {
    session.post({ type: "kitsResult", id, ok: false, error: formatError(error) });
  }
}

/** Saves deck.html and, when it has unsaved changes, theme.css. */
async function saveDeck(session: DeckPanel): Promise<void> {
  await session.document.save();
  const theme = await vscode.workspace.openTextDocument(session.themeUri).then((open) => open, () => undefined);
  if (theme?.isDirty) await theme.save();
  session.post({ type: "dirty", dirty: session.document.isDirty });
}

/** Runs labshelf.decks.<command> on the deck; a command nobody registered only logs a warning. */
async function runDeckCommand(deps: DeckEditorProviderDeps, document: vscode.TextDocument, command: Extract<DeckPageMessage, { type: "command" }>["command"]): Promise<void> {
  // Undo and redo are VS Code's own commands on the deck document.
  if (command === "undo" || command === "redo") return void (await vscode.commands.executeCommand(command));
  const id = `labshelf.decks.${command}`;
  const known = await vscode.commands.getCommands(true);
  if (!known.includes(id)) {
    void deps.logger.log("WARN", MODULE, `The deck command ${id} is not registered.`, { command });
    return;
  }
  await vscode.commands.executeCommand(id, document.uri);
}

async function receive(deps: DeckEditorProviderDeps, session: DeckPanel, message: DeckPageMessage, becomeReady: () => void): Promise<void> {
  switch (message.type) {
    case "ready":
      becomeReady();
      await sendInit(session);
      return;
    case "edit":
      // A stale edit comes back as an update from the sync; a refused one leaves the page ahead until the next update.
      await session.sync.applyFromPage(message);
      return;
    case "save":
      await saveDeck(session);
      return;
    case "pickImage":
      await pickImage(session, message.id);
      return;
    case "kits":
      await answerKits(deps, session, message);
      return;
    case "command":
      await runDeckCommand(deps, session.document, message.command);
  }
}

/** Moves a deck that opened in a later editor group holding nothing else but webviews (the closing preview) into the first group, so the split closes and the deck takes the whole editor area. */
async function joinFirstGroup(panel: vscode.WebviewPanel): Promise<void> {
  const groups = vscode.window.tabGroups.all;
  const own = groups.find((group) => group.viewColumn === panel.viewColumn);
  if (!panel.active || !own || own === groups[0]) return;
  const alone = own.tabs.every((tab) => tab.input instanceof vscode.TabInputWebview || (tab.input instanceof vscode.TabInputCustom && tab.isActive));
  if (alone) await vscode.commands.executeCommand("workbench.action.moveEditorToFirstGroup");
}

export function createDeckEditorProvider(deps: DeckEditorProviderDeps): vscode.CustomTextEditorProvider {
  return {
    async resolveCustomTextEditor(document, panel) {
      const { extensionUri, logger } = deps;
      const folder = vscode.Uri.joinPath(document.uri, "..");
      const themeUri = vscode.Uri.joinPath(folder, "theme.css");
      panel.webview.options = { enableScripts: true, localResourceRoots: [bundleDirectory(extensionUri), webviewChunksDir(extensionUri), folder] };
      let ready = false;
      const post = (message: DeckHostMessage): void => { if (ready) void panel.webview.postMessage(message); };
      const session: DeckPanel = { document, folder, themeUri, panel, sync: createDeckSync(document, themeUri, post), post };
      const postDirty = (changed: vscode.TextDocument): void => { if (changed === document) post({ type: "dirty", dirty: document.isDirty }); };
      const closePreview = (): void => {
        const project = findOwningProject(deps.projects, document.uri.fsPath);
        if (project) deps.closePreview?.(project.folder);
      };
      closePreview();
      void joinFirstGroup(panel).catch((error: unknown) => void logger.error(MODULE, error, { action: "joinFirstGroup" }));
      const subscriptions: vscode.Disposable[] = [
        panel.onDidChangeViewState(() => { if (panel.active) closePreview(); }),
        vscode.workspace.onDidChangeTextDocument((event) => postDirty(event.document)),
        vscode.workspace.onDidSaveTextDocument(postDirty),
        panel.webview.onDidReceiveMessage((raw: unknown) => {
          const message = parseDeckPageMessage(raw);
          if (!message) return;
          void receive(deps, session, message, () => { ready = true; }).catch((error: unknown) => {
            void logger.error(MODULE, error, { action: message.type });
            post({ type: "error", message: formatError(error) });
          });
        }),
      ];
      panel.onDidDispose(() => {
        session.sync.dispose();
        while (subscriptions.length) subscriptions.pop()?.dispose();
      });
      panel.webview.html = await deckPanelHtml(panel.webview, extensionUri, "LabShelf Deck Editor");
    },
  };
}
