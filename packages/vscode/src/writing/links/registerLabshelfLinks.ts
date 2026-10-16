// Registers the labshelf: link provider, its hover and the URI handler that open papers in the reader.
import * as vscode from "vscode";

import type { LinkLibrary } from "./findPaperLinks.js";
import { LabshelfLinkHoverProvider } from "./labshelfLinkHover.js";
import { LabshelfLinkProvider } from "./labshelfLinkProvider.js";
import { LabshelfUriHandler } from "./labshelfUriHandler.js";

const ANY_DOCUMENT = [{ scheme: "file" }, { scheme: "untitled" }];

export function registerLabshelfLinks(context: vscode.ExtensionContext, library: LinkLibrary): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(ANY_DOCUMENT, new LabshelfLinkProvider(library)),
    vscode.languages.registerHoverProvider(ANY_DOCUMENT, new LabshelfLinkHoverProvider(library)),
    vscode.window.registerUriHandler(new LabshelfUriHandler(library)),
  );
}
