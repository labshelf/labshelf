// Starts the helper's loopback WebSocket server that admits one authenticated extension page at a time.
// CONTRACT: documents/contracts/helper.md#transport
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { ILogger } from "../../../ports/index.js";
import { HelperConnection, type ConnectionHandler } from "./helperConnection.js";
import { checkUpgrade } from "./upgrade.js";

const MODULE = "helperSocket";
const AUTH_TIMEOUT_MS = 10_000;

export interface HelperServerOptions {
  token: string;
  /** The origin the page sent in `hello`. */
  origin: string;
  /** The caller origin Chrome passed as the helper's first argument, when it did. */
  callerOrigin?: string | undefined;
  logger: ILogger;
  handle: ConnectionHandler;
  /** Closes a socket that has not authenticated within this time; 10 s when absent. */
  authTimeoutMs?: number;
}

export interface HelperServer {
  port: number;
  close(): Promise<void>;
}

export async function startHelperServer(options: HelperServerOptions): Promise<HelperServer> {
  const { logger } = options;
  const connections = new Set<HelperConnection>();
  let live: HelperConnection | undefined;
  // INVARIANT: the token authenticates one socket; the page reconnects through a new native hello, which mints a new token.
  let spent = false;
  const hooks = {
    token: options.token, logger, handle: options.handle, authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    claim: (connection: HelperConnection) => (live === undefined && !spent ? ((live = connection), true) : false),
    release: (connection: HelperConnection) => {
      connections.delete(connection);
      if (live === connection) { live = undefined; spent = true; }
    },
  };

  const server = createServer((_request, response) => { response.writeHead(426, { Connection: "close" }).end(); });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const verdict = checkUpgrade(request, { origin: options.origin, callerOrigin: options.callerOrigin });
    if (!verdict.accepted) {
      void logger.log("WARN", MODULE, `Refused helper socket upgrade: ${verdict.reason}`);
      socket.end(verdict.response, () => socket.destroy());
      return;
    }
    socket.write(verdict.response);
    const connection = new HelperConnection(socket, hooks);
    connections.add(connection);
    if (head.length > 0) { socket.unshift(head); }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const { port } = server.address() as AddressInfo;
  void logger.log("INFO", MODULE, "Helper socket listening", { port });

  let closed: Promise<void> | undefined;
  return {
    port,
    close: () => {
      closed ??= new Promise<void>((resolve) => {
        for (const connection of connections) { connection.destroy(); }
        server.close(() => resolve());
      });
      return closed;
    },
  };
}
