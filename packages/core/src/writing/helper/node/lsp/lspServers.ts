// Keeps one Tinymist language server per open Typst project and relays JSON-RPC between it and the page.
// CONTRACT: documents/contracts/helper.md#messages
import type { ILogger } from "../../../../ports/index.js";
import type { HelperSend } from "../dispatch/index.js";
import type { HelperProjects } from "../projects/index.js";
import { MODULE, REFUSED_COMMAND, refuse, relayFromServer, spawnServer, writeDocumentChange, writePageMessage, type Server } from "./servers/index.js";
import type { ManagedTinymist, SpawnLsp } from "./tinymistTypes.js";

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

export function createLspServers(options: LspServersOptions): LspServers {
  const { logger } = options;
  const servers = new Map<string, Promise<Server>>();
  // INVARIANT: the helper has one socket, so the latest `send` reaches the page that owns every server.
  let toPage: HelperSend | undefined;

  function serverOf(projectId: string, requestId: string, send: HelperSend): Promise<Server> {
    toPage = send;
    let server = servers.get(projectId);
    if (!server) {
      server = spawnServer({
        options, projectId, requestId, send,
        onMessage: (rootDir, message, reply) => relayFromServer({ logger, projectId, rootDir, message, reply, toPage }),
        onUnexpectedExit: () => { servers.delete(projectId); },
      });
      servers.set(projectId, server);
      server.catch(() => { servers.delete(projectId); });
    }
    return server;
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
      if (payload.method === REFUSED_COMMAND) { return refuse(logger, send, projectId, payload, `${REFUSED_COMMAND} is not available`); }
      writePageMessage(logger, await serverOf(projectId, requestId, send), send, projectId, payload);
    },

    async edited(projectId, file, version) {
      const server = await servers.get(projectId)?.catch(() => undefined);
      if (server) { await writeDocumentChange(server, file, version, (name) => options.projects.textOf(projectId, name)); }
    },

    stop,
    stopAll: async () => { await Promise.all([...servers.keys()].map(stop)); },
  };
}
