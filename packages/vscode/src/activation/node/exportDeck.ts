// Desktop deck export: Export HTML writes the single-file deck beside it, Export PDF prints it through Chromium or opens the print fallback.
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { Logger, POSTER_PDF_CHOICES, exportDeckHtml, formatError, parseDeck, type ILogger, type PrintMarksOptions } from "@labshelf/core";
import { createSharedChromiumProvider, exportDeckPdf, type ChromiumCandidate, type ManagedChromiumProvider } from "@labshelf/core/decks/node";

export interface DeckExportDeps { exportPdf: typeof exportDeckPdf; exportHtml: typeof exportDeckHtml; logger: ILogger; chromium?: ManagedChromiumProvider }

const MODULE = "decks/export";
const EXPORT_PDF = "labshelf.decks.exportPdf";
const EXPORT_HTML = "labshelf.decks.exportHtml";
const OPEN = "Open";
const REVEAL = "Reveal";
const REPLACE = "Replace";
const INSTALL_CHROMIUM = "Install Chromium";

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** The deck's document with its unsaved edits written to disk. */
async function savedDeckText(deckUri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === deckUri.toString());
  const doc = open ?? await vscode.workspace.openTextDocument(deckUri);
  if (doc.isDirty) { await doc.save(); }
  return doc.getText();
}

function readerOf(folder: string): { theme: Promise<string>; readAsset(assetPath: string): Promise<Uint8Array | undefined> } {
  const read = async (file: string): Promise<Uint8Array | undefined> => {
    try {
      return await vscode.workspace.fs.readFile(vscode.Uri.file(file));
    } catch {
      return undefined;
    }
  };
  return {
    theme: read(path.join(folder, "theme.css")).then((bytes) => new TextDecoder().decode(bytes ?? new Uint8Array())),
    readAsset: (assetPath) => read(path.resolve(folder, ...assetPath.split("/"))),
  };
}

/** Tells the user a file was written, with Open (and Reveal for the HTML). Not awaited by callers: the export must not wait for the user. */
function announce(file: vscode.Uri, reveal: boolean): void {
  const name = path.basename(file.fsPath);
  const buttons = reveal ? [OPEN, REVEAL] : [OPEN];
  void Promise.resolve(vscode.window.showInformationMessage(`Exported ${name}`, ...buttons)).then(async (choice) => {
    if (choice === OPEN) { await vscode.env.openExternal(file); }
    else if (choice === REVEAL) { await vscode.commands.executeCommand("revealFileInOS", file); }
  });
}

async function exportHtmlFile(deckUri: vscode.Uri, folder: string, html: string, deps: DeckExportDeps): Promise<vscode.Uri | undefined> {
  const out = vscode.Uri.file(path.join(folder, `${path.basename(folder)}.html`));
  const name = path.basename(out.fsPath);
  if (await exists(out) && await vscode.window.showWarningMessage(`Replace ${name}?`, { modal: true }, REPLACE) !== REPLACE) { return undefined; }
  const assets = readerOf(folder);
  const single = await deps.exportHtml(html, { theme: await assets.theme, readAsset: assets.readAsset });
  await vscode.workspace.fs.writeFile(out, new TextEncoder().encode(single));
  await deps.logger.log("INFO", MODULE, "deck exported as HTML", { deck: deckUri.fsPath, out: out.fsPath });
  announce(out, true);
  return out;
}

async function installChromium(chromium: ManagedChromiumProvider, logger: ILogger): Promise<void> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Installing Chromium" }, async (progress) => {
      await chromium.install((step) => progress.report({ message: step }));
    });
    void vscode.window.showInformationMessage("Chromium is installed. Export the PDF again to save it.");
  } catch (error) {
    await logger.error(MODULE, error, { step: "install chromium" });
    void vscode.window.showErrorMessage(`Chromium install failed: ${formatError(error)}`);
  }
}

function reportFallback(htmlPath: string, message: string, deps: DeckExportDeps): void {
  void Promise.resolve(vscode.env.openExternal(vscode.Uri.file(htmlPath).with({ fragment: "print" })));
  const { chromium } = deps;
  const buttons = chromium ? [INSTALL_CHROMIUM] : [];
  void Promise.resolve(vscode.window.showInformationMessage(message, ...buttons)).then(async (choice) => {
    if (choice === INSTALL_CHROMIUM && chromium) { await installChromium(chromium, deps.logger); }
  });
}

/** Finds the managed Chromium when it is installed; undefined leaves exportDeckPdf to its default search. */
async function managedFinder(chromium: ManagedChromiumProvider | undefined): Promise<(() => Promise<ChromiumCandidate | undefined>) | undefined> {
  const status = await chromium?.status();
  if (!status?.installed || !status.executable) { return undefined; }
  const candidate: ChromiumCandidate = { path: status.executable, source: "managed" };
  return async () => candidate;
}

/** For a poster, asks PDF, PDF with bleed or PDF with bleed and crop marks: the picked marks, null for plain PDF, undefined on Escape. A talk never asks. */
async function pickPosterMarks(html: string): Promise<PrintMarksOptions | null | undefined> {
  if (parseDeck(html).model?.kind !== "poster") { return null; }
  const items = POSTER_PDF_CHOICES.map((choice) => ({ label: choice.label, detail: choice.detail, marks: choice.marks }));
  const picked = await vscode.window.showQuickPick(items, { title: "Export poster PDF" });
  return picked ? picked.marks : undefined;
}

async function exportPdfFile(deckUri: vscode.Uri, folder: string, html: string, deps: DeckExportDeps): Promise<vscode.Uri | undefined> {
  const marks = await pickPosterMarks(html);
  if (marks === undefined) { return undefined; }
  const out = path.join(folder, `${path.basename(folder)}.pdf`);
  const find = await managedFinder(deps.chromium);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Exporting PDF" },
    () => deps.exportPdf(html, { out, logger: deps.logger, ...(find ? { find } : {}), ...(marks ? { marks } : {}) }),
  );
  if (result.kind === "fallback") {
    await deps.logger.log("INFO", MODULE, "deck PDF fell back to printing", { deck: deckUri.fsPath, message: result.message });
    reportFallback(result.htmlPath, result.message, deps);
    return undefined;
  }
  await deps.logger.log("INFO", MODULE, "deck exported as PDF", { deck: deckUri.fsPath, out: result.path });
  const written = vscode.Uri.file(result.path);
  announce(written, false);
  return written;
}

/** Exports the deck beside itself as `<folder name>.pdf` or `<folder name>.html`; the uri of the file written, undefined on cancel, fallback or failure. */
export async function runDeckExport(deckUri: vscode.Uri, format: "pdf" | "html", deps: DeckExportDeps): Promise<vscode.Uri | undefined> {
  try {
    const html = await savedDeckText(deckUri);
    const folder = path.dirname(deckUri.fsPath);
    return format === "html" ? await exportHtmlFile(deckUri, folder, html, deps) : await exportPdfFile(deckUri, folder, html, deps);
  } catch (error) {
    await deps.logger.error(MODULE, error, { deck: deckUri.fsPath, format });
    void vscode.window.showErrorMessage(`Export failed: ${formatError(error)}`);
    return undefined;
  }
}

function targetOf(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  if (uri) { return uri; }
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input && typeof input === "object" && "uri" in input && input.uri instanceof vscode.Uri ? input.uri : undefined;
}

/** Registers Export PDF and Export HTML for the deck of the active tab or the given uri. */
export function registerDeckExport(context: vscode.ExtensionContext, deps: Partial<DeckExportDeps> = {}): void {
  const logger = deps.logger ?? new Logger([]);
  const chromium = deps.chromium ?? createSharedChromiumProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const all: DeckExportDeps = { exportPdf: deps.exportPdf ?? exportDeckPdf, exportHtml: deps.exportHtml ?? exportDeckHtml, logger, chromium };
  const register = (id: string, format: "pdf" | "html") => vscode.commands.registerCommand(id, async (uri?: vscode.Uri) => {
    const deck = targetOf(uri);
    if (deck) { await runDeckExport(deck, format, all); }
  });
  context.subscriptions.push(register(EXPORT_PDF, "pdf"), register(EXPORT_HTML, "html"));
}
