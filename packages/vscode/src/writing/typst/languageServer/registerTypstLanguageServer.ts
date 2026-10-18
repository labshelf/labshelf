// Starts the Typst language server on the first opened Typst document and keeps the project's main file pinned in it.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { createManagedTinymist } from "@labshelf/core/typst/node";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { createLanguageClient } from "./createLanguageClient.js";
import { TypstLanguageServer } from "./typstLanguageServer.js";
import { registerTypstMainPin } from "./typstMainPin.js";

export interface TypstLanguageServerRegistration {
  context: vscode.ExtensionContext;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">;
}

const isTypstDocument = (document: vscode.TextDocument): boolean =>
  document.languageId === "typst" && (document.uri.scheme === "file" || document.uri.scheme === "untitled");

// The session's logger exists only while a library is open, and the server can start before that.
function hostLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}

export function registerTypstLanguageServer(deps: TypstLanguageServerRegistration): void {
  const logger = hostLogger(deps.host);
  const server = new TypstLanguageServer({
    tinymist: createManagedTinymist({ logger }),
    createClient: createLanguageClient,
    withInstallProgress: (task) => Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Installing the Typst language server" },
      (progress) => task((message) => progress.report({ message })),
    )),
    showError: (message) => { void vscode.window.showErrorMessage(message); },
    logger,
  });
  const open = (document: vscode.TextDocument): void => { if (isTypstDocument(document)) { void server.start(); } };
  vscode.workspace.textDocuments.forEach(open);
  deps.context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(open),
    { dispose: () => { void server.stop(); } },
  );
  registerTypstMainPin({ context: deps.context, server, host: deps.host, projects: deps.projects });
}
