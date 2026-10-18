// Keeps one Tinymist language server per open Typst project and relays JSON-RPC between it and the page.
// CONTRACT: documents/contracts/helper.md#messages
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import { PROTOCOL_VERSION } from "../../index.js";
import type { HelperSend } from "../dispatch/index.js";
import type { HelperProjects } from "../projects/index.js";
import { ensureTinymistBinary } from "./ensureTinymistBinary.js";
import { fileUriOf, fileUrisToPage, pageUrisToFiles, rootInitialize, UriRefusedError } from "./uriMapping.js";
import { startTinymistProcess, type TinymistProcess } from "./tinymistProcess.js";
import type { ManagedTinymist, SpawnLsp } from "./tinymistTypes.js";

const MODULE = "helper/lsp";
const REFUSED_COMMAND = "workspace/executeCommand";
// JSON-RPC "invalid request": the helper refuses the call, the server never sees it.
const INVALID_REQUEST = -32600;

export interface LspServersOptions {
  /** The helper's data folder; each project's working copy is `projects/<id>/src`. */
  dataDir: string;
  logger: ILogger;
  tinymist: ManagedTinymist;
  projects: Pick<HelperProjects, "syncWorkingCopy" | "textOf">;
  spawn: SpawnLsp;
}

export interface LspServers {
  /** Starts the project's server when none runs; resolves once it is spawned. */
  start(projectId: string, requestId: string, send: HelperSend): Promise<void>;
  /** Relays one page message to the project's server, starting it first. */
  relay(projectId: string, requestId: string, payload: Record<string, unknown>, send: HelperSend): Promise<void>;
  /** Tells a running server the text of an open document changed. */
  edited(projectId: string, file: string, version: number): Promise<void>;
  stop(projectId: string): Promise<void>;
  stopAll(): Promise<void>;
}

interface Server { process: TinymistProcess; rootDir: string; opened: Set<string> }

const isNotification = (message: unknown): boolean => {
  const { method, id } = message as { method?: unknown; id?: unknown };
  return typeof method === "string" && id === undefined;
};

export function createLspServers(options: LspServersOptions): LspServers {
  const { logger, dataDir } = options;
  const servers = new Map<string, Promise<Server>>();
  // INVARIANT: the helper has one socket, so the latest `send` reaches the page that owns every server.
  let toPage: HelperSend | undefined;

  const fromServer = (projectId: string, rootDir: string, message: unknown): void => {
    const { payload, outside } = fileUrisToPage(message, rootDir);
    if (outside.length > 0) {
      void logger.log("WARN", MODULE, "Server named files outside the project", { projectId, count: outside.length, notification: isNotification(message) });
      if (isNotification(message)) { return; }
    }
    toPage?.({ v: PROTOCOL_VERSION, type: "lsp", projectId, payload: payload as Record<string, unknown> });
  };

  async function spawnServer(projectId: string, requestId: string, send: HelperSend): Promise<Server> {
    const binary = await ensureTinymistBinary(options.tinymist, (message, fraction) => {
      send({ v: PROTOCOL_VERSION, id: requestId, type: "progress", phase: "installing-tinymist", message, ...(fraction !== undefined && { fraction }) });
    });
    const rootDir = path.join(dataDir, "projects", projectId, "src");
    await options.projects.syncWorkingCopy(projectId, rootDir);
    const child = startTinymistProcess({
      binary, cwd: rootDir, projectId, spawn: options.spawn, logger,
      onMessage: (message) => fromServer(projectId, rootDir, message),
      onUnexpectedExit: () => { servers.delete(projectId); },
    });
    await logger.log("INFO", MODULE, "Language server started", { projectId });
    return { process: child, rootDir, opened: new Set() };
  }

  function serverOf(projectId: string, requestId: string, send: HelperSend): Promise<Server> {
    toPage = send;
    let server = servers.get(projectId);
    if (!server) {
      server = spawnServer(projectId, requestId, send);
      servers.set(projectId, server);
      server.catch(() => { servers.delete(projectId); });
    }
    return server;
  }

  const refuse = (requestId: string, send: HelperSend, projectId: string, payload: Record<string, unknown>, reason: string): void => {
    void logger.log("WARN", MODULE, "Page message refused", { projectId, method: payload.method, reason });
    // A refused request still gets its answer, or the page's client would wait for it.
    if (payload.id !== undefined && payload.method !== undefined) {
      send({ v: PROTOCOL_VERSION, type: "lsp", projectId, payload: { jsonrpc: "2.0", id: payload.id, error: { code: INVALID_REQUEST, message: reason } } });
    }
  };

  function trackDocuments(server: Server, message: Record<string, unknown>): void {
    const uri = ((message.params as { textDocument?: { uri?: unknown } } | undefined)?.textDocument)?.uri;
    if (typeof uri !== "string") { return; }
    if (message.method === "textDocument/didOpen") { server.opened.add(uri); }
    if (message.method === "textDocument/didClose") { server.opened.delete(uri); }
  }

  async function stop(projectId: string): Promise<void> {
    const server = await servers.get(projectId)?.catch(() => undefined);
    servers.delete(projectId);
    if (!server) { return; }
    server.process.stop();
    await logger.log("INFO", MODULE, "Language server stopped", { projectId });
  }

  return {
    async start(projectId, requestId, send) { await serverOf(projectId, requestId, send); },

    async relay(projectId, requestId, payload, send) {
      if (payload.method === REFUSED_COMMAND) { return refuse(requestId, send, projectId, payload, `${REFUSED_COMMAND} is not available`); }
      const server = await serverOf(projectId, requestId, send);
      let message: Record<string, unknown>;
      try {
        message = rootInitialize(pageUrisToFiles(payload, server.rootDir) as Record<string, unknown>, server.rootDir);
      } catch (error) {
        if (!(error instanceof UriRefusedError)) { throw error; }
        return refuse(requestId, send, projectId, payload, error.message);
      }
      trackDocuments(server, message);
      server.process.write(message);
    },

    async edited(projectId, file, version) {
      const server = await servers.get(projectId)?.catch(() => undefined);
      if (!server) { return; }
      const uri = fileUriOf(server.rootDir, file);
      if (!server.opened.has(uri)) { return; }
      const text = await options.projects.textOf(projectId, file);
      server.process.write({
        jsonrpc: "2.0", method: "textDocument/didChange",
        params: { textDocument: { uri, version }, contentChanges: [{ text }] },
      });
    },

    stop,
    stopAll: async () => { await Promise.all([...servers.keys()].map(stop)); },
  };
}
