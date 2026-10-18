// Creates the vscode-languageclient that runs the Typst language server binary over stdio.
import type { ServerOptions } from "vscode-languageclient/node";

import type { LanguageClientHandle } from "./typstLanguageServer.js";

// Loaded on the first Typst document, so activation never pays for the client library.
export async function createLanguageClient(serverPath: string): Promise<LanguageClientHandle> {
  const { LanguageClient } = await import("vscode-languageclient/node.js");
  const server: ServerOptions = { command: serverPath, args: ["lsp"] };
  const client = new LanguageClient(
    "labshelf.typst",
    "LabShelf Typst Language Server",
    server,
    { documentSelector: [{ language: "typst", scheme: "file" }, { language: "typst", scheme: "untitled" }] },
  );
  return {
    start: () => client.start(),
    stop: () => client.stop(),
    sendRequest: (method, params) => client.sendRequest(method, params),
  };
}
