// Registers Typst completion, hover and go-to-definition from LabShelf's Typst language service.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { createTypstCompletionProvider } from "./typstCompletionProvider.js";
import { createTypstDefinitionProvider } from "./typstDefinitionProvider.js";
import { createTypstContexts } from "./typstDocumentContext.js";
import { createTypstHoverProvider } from "./typstHoverProvider.js";

export interface TypstLanguageRegistration {
  context: vscode.ExtensionContext;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "paths">;
}

const TRIGGER_CHARACTERS = ["#", "@", ".", "<", "(", "\"", "/"];

// The session's logger exists only while a library is open, and a provider can run before that.
function hostLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}

export function registerTypstLanguage(deps: TypstLanguageRegistration): void {
  const contextOf = createTypstContexts(deps.projects, hostLogger(deps.host));
  const selector: vscode.DocumentSelector = [
    { language: "typst", scheme: "file" },
    { language: "typst", scheme: "untitled" },
  ];
  deps.context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, createTypstCompletionProvider(contextOf), ...TRIGGER_CHARACTERS),
    vscode.languages.registerHoverProvider(selector, createTypstHoverProvider(contextOf)),
    vscode.languages.registerDefinitionProvider(selector, createTypstDefinitionProvider(contextOf)),
  );
}
