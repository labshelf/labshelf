// Share Deck as Link and Insert QR Code for a deck.html: shares the saved deck through the sharing host and copies the link, and writes the QR of a deck's link beside the deck with one edit.
import * as path from "node:path";
import * as vscode from "vscode";

import { SHARE_STAGE_TEXT, deckTitleOf, formatError, insertShareQr, newestDeckLink, type ShareHost } from "@labshelf/core";

const OPEN_LINK = "Open Link";
const INSERT_QR = "Insert QR Code";
const SHARE_ACTION = "Share";
const SHARE_FIRST = "Share this deck first.";

/** The deck's document, saved when it has unsaved edits. */
async function savedDeckDocument(deckUri: vscode.Uri): Promise<vscode.TextDocument> {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === deckUri.toString());
  const doc = open ?? await vscode.workspace.openTextDocument(deckUri);
  if (doc.isDirty) { await doc.save(); }
  return doc;
}

/** The title of the deck at `deckUri`, as its share is listed. */
async function readDeckTitle(deckUri: vscode.Uri): Promise<string> {
  const doc = await savedDeckDocument(deckUri);
  return deckTitleOf(doc.getText(), path.basename(path.dirname(deckUri.fsPath)));
}

/** The link of the deck's newest share on this device; undefined, after offering to share it, when it has none. */
export async function findDeckLink(deckUri: vscode.Uri, host: ShareHost): Promise<string | undefined> {
  const title = await readDeckTitle(deckUri);
  const found = newestDeckLink(await host.sharedLinks(), title);
  if (found) { return found.link; }
  const choice = await vscode.window.showInformationMessage(SHARE_FIRST, SHARE_ACTION);
  if (choice === SHARE_ACTION) { await vscode.commands.executeCommand("labshelf.decks.shareLink", deckUri); }
  return undefined;
}

/**
 * Saves the deck when it has unsaved edits, shares it after the rights notice and copies the link; the link, or undefined on cancel, no relay or failure.
 * `ui.info` shows the message with the actions and answers the one picked.
 */
export async function runShareDeck(
  deckUri: vscode.Uri,
  host: ShareHost,
  ui: { copyText(text: string): Promise<boolean>; info(message: string, ...actions: string[]): Thenable<string | undefined> },
): Promise<string | undefined> {
  try {
    const title = await readDeckTitle(deckUri);
    const share = "Share Deck";
    const accepted = await vscode.window.showWarningMessage(
      `Share "${title}" as a link?`,
      { modal: true, detail: "You are responsible for having the right to share this deck and everything in it. Anyone who has the link can open it until you revoke it in Manage Shared Links." },
      share,
    );
    if (accepted !== share) { return undefined; }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Sharing "${title}"` },
      (progress) => host.shareDeck(deckUri.fsPath, (step) => {
        if ("stage" in step) { progress.report({ message: SHARE_STAGE_TEXT[step.stage] }); }
      }),
    );
    // The host has already offered to connect Cloudflare when there is no relay.
    if (result.kind === "noRelay") { return undefined; }
    const copied = await ui.copyText(result.link);
    const choice = await ui.info(copied ? "Link copied." : `Share link: ${result.link}`, OPEN_LINK, INSERT_QR);
    if (choice === OPEN_LINK) { await host.openLink(result.link); }
    else if (choice === INSERT_QR) { await runInsertQr(deckUri, result.link, 0); }
    return result.link;
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not share the deck: ${formatError(error)}`);
    return undefined;
  }
}

/** The one replacement that turns `before` into `after`: everything outside their common prefix and suffix stays. */
function replacementOf(doc: vscode.TextDocument, before: string, after: string): { range: vscode.Range; text: string } {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) { start += 1; }
  let tail = 0;
  while (tail < shortest - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) { tail += 1; }
  return { range: new vscode.Range(doc.positionAt(start), doc.positionAt(before.length - tail)), text: after.slice(start, after.length - tail) };
}

/** Writes assets/share-qr.svg beside the deck (overwriting) and adds its image block to `slide` in one edit; false when the deck cannot take it. */
export async function runInsertQr(deckUri: vscode.Uri, link: string, slide: number): Promise<boolean> {
  try {
    const doc = await savedDeckDocument(deckUri);
    const before = doc.getText();
    const result = insertShareQr(before, link, slide);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`Could not insert the QR code: ${result.error}`);
      return false;
    }
    const { svgPath, svg, html } = result.insert;
    const folder = vscode.Uri.file(path.dirname(deckUri.fsPath));
    const svgUri = vscode.Uri.file(path.join(folder.fsPath, ...svgPath.split("/")));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(svgUri.fsPath)));
    await vscode.workspace.fs.writeFile(svgUri, new TextEncoder().encode(svg));
    const edit = new vscode.WorkspaceEdit();
    const { range, text } = replacementOf(doc, before, html);
    edit.replace(deckUri, range, text);
    return await vscode.workspace.applyEdit(edit);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not insert the QR code: ${formatError(error)}`);
    return false;
  }
}
