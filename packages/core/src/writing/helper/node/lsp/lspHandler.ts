// Answers the page's `lsp` messages by relaying them to the project's language server.
import type { HelperHandler } from "../dispatch/index.js";
import type { LspServers } from "./lspServers.js";

export function createLspHandler(servers: Pick<LspServers, "relay">): HelperHandler {
  return async (message, send) => {
    if (message.type !== "lsp") { throw new Error(`lsp handler received ${message.type}`); }
    await servers.relay(message.projectId, message.id, message.payload, send);
  };
}
